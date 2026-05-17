import './App.css';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';

import React, { useEffect, useRef, useState } from 'react';
import Lottie from 'lottie-react';
import {
  MainContainer,
  ChatContainer,
  MessageList,
  Message,
  MessageInput,
} from '@chatscope/chat-ui-kit-react';

import {
  AttachmentContent,
  ChatMessage,
  Conversation,
  ConversationRole,
  HtmlContent,
  ImageContent,
  IStorage,
  MessageContentType,
  MessageDirection,
  MessageStatus,
  Participant,
  Presence,
  User,
  UserStatus,
  useChat,
} from '@chatscope/use-chat';

import { MultipleChoiceBubble } from './MultipleChoiceBubble';
import {
  archiveSession,
  clearArchivedSessions,
  loadArchivedSessions,
} from './sessionArchive';

// IDs we'll use to seed the store. In a real app these come from your
// auth/session + wherever you fetch conversations from.
const CURRENT_USER_ID = 'me';
const DEFAULT_CONVERSATION_ID = 'chat-1';

// Extra metadata we stash in message content so the renderer knows the
// original file name / size. The library types these fields as `unknown`,
// so we keep our own typed shape and cast when we read it back.
// `lottieData` holds the parsed Lottie JSON animation when the attachment
// was recognised as a Lottie file; otherwise it's undefined.
type AttachmentExtra = {
  name: string;
  size: number;
  mimeType: string;
  lottieData?: unknown;
};
type StoredAttachment = AttachmentContent & AttachmentExtra;
type StoredImage = ImageContent & AttachmentExtra;

// Heuristic Lottie detection: a Lottie JSON document always has a
// version string (`v`) and an array of `layers`. This keeps us from
// trying to animate any old JSON the user drops in.
function isLottieJson(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return typeof o.v === 'string' && Array.isArray(o.layers);
}

// Read a File as a parsed JSON object. Resolves to `null` if the file
// isn't valid JSON (so the caller can fall back to a normal attachment).
function readJsonFile(file: File): Promise<unknown | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)));
      } catch {
        resolve(null);
      }
    };
    reader.readAsText(file);
  });
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---- Multiple-choice message shape -----------------------------------------
// Multiple-choice prompts ride on top of MessageContentType.Other. We use a
// `kind` discriminator on the content so we can add other "structured"
// message types later (polls, cards, quick-replies…) without a new enum.
type MultipleChoiceContent = {
  kind: 'multipleChoice';
  question: string;
  choices: string[];
  // null/undefined = unanswered. Once the user picks, we update the
  // message in storage so the answer survives re-renders and conversation
  // switches.
  selectedIndex: number | null;
};

function isMultipleChoiceContent(c: unknown): c is MultipleChoiceContent {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  return (
    o.kind === 'multipleChoice' &&
    typeof o.question === 'string' &&
    Array.isArray(o.choices)
  );
}

// ---- Session state ---------------------------------------------------------
// Per-conversation phase. Everything except Done is derived from existing
// data on each render; Done lives on Conversation.data so it persists with
// the rest of conversation state.
export type SessionState = 'Empty' | 'Open' | 'Pending' | 'Done';

// What we stash on Conversation.data. Keep it small and JSON-friendly —
// future fields (saved session id, archived flag, …) can be added here.
type ConvData = { done?: boolean };

/**
 * Compute the current SessionState for a conversation.
 *
 *   Done    — conversation.data.done is true.
 *   Empty   — no messages and no draft text.
 *   Pending — there is an unanswered multiple-choice bubble OR a non-empty
 *             draft typed into the input.
 *   Open    — otherwise (history exists, nothing uncommitted).
 */
function deriveSessionState(
  messageGroups: Array<{ messages: Array<{ contentType: number; content: unknown }> }>,
  draft: string,
  convData?: ConvData
): SessionState {
  if (convData?.done) return 'Done';

  const allMessages = messageGroups.flatMap((g) => g.messages);
  const hasDraft = draft.trim().length > 0;

  if (allMessages.length === 0 && !hasDraft) return 'Empty';

  const hasPendingMCQ = allMessages.some(
    (m) =>
      m.contentType === MessageContentType.Other &&
      isMultipleChoiceContent(m.content) &&
      m.content.selectedIndex === null
  );

  if (hasPendingMCQ || hasDraft) return 'Pending';
  return 'Open';
}

function Chat() {
  const {
    currentMessages,
    activeConversation,
    setCurrentUser,
    addUser,
    addConversation,
    setActiveConversation,
    getUser,
    getConversation,
    sendMessage,
    updateMessage,
    currentMessage,
    setCurrentMessage,
    service,
    updateState,
    removeMessagesFromConversation,
  } = useChat();

  // Hidden file input — we click() it programmatically when the paperclip
  // button is pressed, because MessageInput doesn't open a picker itself.
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Dev-only state for the local-storage inspector panel.
  // `storageOpen` controls visibility; `storageTick` is bumped whenever
  // we want to force a fresh read from localStorage (after a clear, or
  // after the user pressed Refresh).
  const [storageOpen, setStorageOpen] = useState(false);
  const [storageTick, setStorageTick] = useState(0);

  // Block free-text input while there is an unanswered multiple-choice
  // bubble in the conversation — the user must pick an option first.
  const hasPendingMCQ = currentMessages.some((group) =>
    group.messages.some(
      (m) =>
        m.contentType === MessageContentType.Other &&
        isMultipleChoiceContent(m.content) &&
        m.content.selectedIndex === null
    )
  );

  // Per-conversation phase. Empty/Open/Pending are derived from messages
  // and the live draft; Done is a flag stored on conversation.data so it
  // survives reloads and conversation switches.
  const activeConv = activeConversation
    ? (getConversation(activeConversation.id) as
        | Conversation<ConvData>
        | undefined)
    : undefined;

  const sessionState = deriveSessionState(
    currentMessages,
    currentMessage ?? '',
    activeConv?.data
  );

  // The input is locked while the user has an unanswered MCQ to address
  // OR the chat is already Done. Drafts shouldn't lock the input —
  // they're how a Pending session gets unstuck.
  const inputLocked = hasPendingMCQ || sessionState === 'Done';

  // Imperative transition to Done. This is the seam to wire up to the
  // forthcoming "system message that ends the session" — when that
  // message arrives, its handler should call this function. For now a
  // demo button below calls it directly so the transition is testable.
  const markConversationDone = (conversationId: string) => {
    // IChatService doesn't expose `storage` in its public type, but the
    // concrete implementation we wire up in index.tsx does. Cast to reach it.
    const storage = (service as unknown as { storage?: IStorage })?.storage;
    if (!storage) return;
    const [conv] = storage.getConversation(conversationId);
    if (!conv) return;
    const typed = conv as Conversation<ConvData>;
    typed.data = { ...(typed.data ?? {}), done: true };
    storage.updateConversation(typed);
    updateState();
  };

  // Restart a conversation: wipe its message history, clear the input
  // draft, and reset the Done flag so the next interaction starts from
  // a clean Empty state.
  //
  // SESSION-HISTORY SEAM: when we add the saved-sessions feature, this
  // is the exact place to snapshot the current conversation
  // (messages + data) into the archive store *before* clearing. Empty
  // sessions skip the snapshot — there's nothing to record.
  const restartConversation = (conversationId: string) => {
    // IChatService doesn't expose `storage` in its public type, but the
    // concrete implementation we wire up in index.tsx does. Cast to reach it.
    const storage = (service as unknown as { storage?: IStorage })?.storage;

    // Snapshot the finished conversation into the persistent archive
    // BEFORE we clear anything. This is what gives us a session history
    // in browser localStorage. An empty conversation isn't worth storing,
    // so we skip if there are no messages.
    const flatMessages = currentMessages.flatMap((g) => g.messages);
    if (flatMessages.length > 0) {
      let convData: Record<string, unknown> = {};
      if (storage) {
        const [conv] = storage.getConversation(conversationId);
        if (conv) {
          convData = ((conv as Conversation<ConvData>).data ?? {}) as Record<
            string,
            unknown
          >;
        }
      }
      archiveSession({
        conversationId,
        data: convData,
        messages: flatMessages,
      });
    }

    removeMessagesFromConversation(conversationId);

    // Clear any draft text from the (now-restarted) input.
    setCurrentMessage('');

    // Reset the Done flag so the conversation is usable again.
    if (storage) {
      const [conv] = storage.getConversation(conversationId);
      if (conv) {
        const typed = conv as Conversation<ConvData>;
        typed.data = { ...(typed.data ?? {}), done: false };
        storage.updateConversation(typed);
      }
    }

    updateState();
  };

  // One-time bootstrap: make sure there's a current user and at least one
  // conversation in storage, and that the conversation is active. Without
  // an active conversation, sendMessage has nowhere to put the message.
  useEffect(() => {
    if (!getUser(CURRENT_USER_ID)) {
      const me = new User({
        id: CURRENT_USER_ID,
        presence: new Presence({ status: UserStatus.Available }),
        firstName: 'Me',
        lastName: '',
        username: 'me',
        email: '',
        avatar: '',
        bio: '',
      });
      addUser(me);
      setCurrentUser(me);
    }

    if (!getConversation(DEFAULT_CONVERSATION_ID)) {
      addConversation(
        new Conversation({
          id: DEFAULT_CONVERSATION_ID,
          participants: [
            new Participant({
              id: CURRENT_USER_ID,
              role: new ConversationRole([]),
            }),
          ],
          unreadCounter: 0,
          description: 'Chat 1',
        })
      );
    }

    setActiveConversation(DEFAULT_CONVERSATION_ID);
    // We only want this to run once on mount.
  }, []);

  const handleSend = (innerHtml: string, textContent: string) => {
    if (!activeConversation) return;

    const message = new ChatMessage({
      id: '', // BasicStorage will assign one when generateId is true
      content: { content: textContent } as HtmlContent,
      contentType: MessageContentType.TextHtml,
      senderId: CURRENT_USER_ID,
      direction: MessageDirection.Outgoing,
      status: MessageStatus.Sent,
    });

    sendMessage({
      message,
      conversationId: activeConversation.id,
      senderId: CURRENT_USER_ID,
      generateId: true,
    });

    // The input is controlled by currentMessage / setCurrentMessage, so
    // clear it after a successful send. Without this, the draft would
    // linger and keep the session in Pending state.
    setCurrentMessage('');
  };

  // Paperclip click → open the hidden file picker.
  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  // Push a new multiple-choice prompt into the active conversation.
  // `direction` defaults to Incoming so it visually appears as a question
  // coming from the other side of the conversation (the "bot"). Pass
  // Outgoing if it's coming from the current user instead.
  const sendMultipleChoice = (
    question: string,
    choices: string[],
    direction: MessageDirection = MessageDirection.Incoming
  ) => {
    if (!activeConversation) return;

    const content: MultipleChoiceContent = {
      kind: 'multipleChoice',
      question,
      choices,
      selectedIndex: null,
    };

    const message = new ChatMessage({
      id: '',
      // MessageContent<T>.content is `unknown`, so casting is fine.
      content: content as unknown as HtmlContent,
      contentType: MessageContentType.Other,
      senderId:
        direction === MessageDirection.Outgoing ? CURRENT_USER_ID : 'bot',
      direction,
      status: MessageStatus.Sent,
    });

    sendMessage({
      message,
      conversationId: activeConversation.id,
      senderId:
        direction === MessageDirection.Outgoing ? CURRENT_USER_ID : 'bot',
      generateId: true,
    });
  };

  // Persist a chosen index back to the message in storage so the answer
  // sticks across re-renders, conversation switches, etc.
  const handleChoicePicked = (
    original: ChatMessage<MessageContentType>,
    pickedIndex: number
  ) => {
    const old = original.content as unknown as MultipleChoiceContent;
    const next = new ChatMessage({
      id: original.id,
      contentType: original.contentType,
      senderId: original.senderId,
      direction: original.direction,
      status: original.status,
      createdTime: original.createdTime,
      updatedTime: new Date(),
      content: {
        ...old,
        selectedIndex: pickedIndex,
      } as unknown as HtmlContent,
    });
    updateMessage(next);
  };

  // Files picked → push each one as its own outgoing message.
  // Async because .json files need to be read & parsed before we can tell
  // whether they're Lottie animations.
  const handleFilesPicked: React.ChangeEventHandler<HTMLInputElement> = async (
    evt
  ) => {
    if (!activeConversation) return;
    const files = evt.target.files;
    if (!files || files.length === 0) return;
    const conversationId = activeConversation.id;

    for (const file of Array.from(files)) {
      // Object URL is enough for local preview/download. When you wire a
      // real backend, upload the file here and use the resulting URL.
      const url = URL.createObjectURL(file);
      const isImage = file.type.startsWith('image/');
      const looksLikeJson =
        file.type === 'application/json' ||
        file.name.toLowerCase().endsWith('.json');

      // For JSON files, try to parse; if it's a valid Lottie payload we
      // stash the parsed object so the renderer can feed it to <Lottie>.
      let lottieData: unknown | undefined;
      if (looksLikeJson) {
        const parsed = await readJsonFile(file);
        if (isLottieJson(parsed)) lottieData = parsed;
      }

      const extra: AttachmentExtra = {
        name: file.name,
        size: file.size,
        mimeType: file.type,
        lottieData,
      };

      const content = isImage
        ? ({ url, data: new ArrayBuffer(0), ...extra } as StoredImage)
        : ({ url, data: new ArrayBuffer(0), ...extra } as StoredAttachment);

      const message = new ChatMessage({
        id: '',
        content,
        contentType: isImage
          ? MessageContentType.Image
          : MessageContentType.Attachment,
        senderId: CURRENT_USER_ID,
        direction: MessageDirection.Outgoing,
        status: MessageStatus.Sent,
      });

      sendMessage({
        message,
        conversationId,
        senderId: CURRENT_USER_ID,
        generateId: true,
      });
    }

    // Reset so picking the same file twice in a row still fires onChange.
    evt.target.value = '';
  };

  return (
    <div style={{ position: 'relative', height: '500px' }}>
      {/* Hidden file input the paperclip button drives. Accept is left
          wide-open so images, video, PDFs, etc. all work. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFilesPicked}
      />

      {/* Session-state badge. Mostly for development visibility — feel
          free to restyle or hide it once you have a proper chat header. */}
      <SessionStateBadge state={sessionState} />

      <MainContainer>
        <ChatContainer className="MyChatContainer">
          <MessageList className="message-list">
            {currentMessages.flatMap((group) =>
              group.messages.map((m) => {
                const direction =
                  m.direction === MessageDirection.Outgoing
                    ? 'incoming'
                    : 'outgoing';
                const sentTime =
                  m.createdTime?.toLocaleTimeString() ?? 'just now';

                // Images → render with Message.ImageContent.
                if (m.contentType === MessageContentType.Image) {
                  const img = m.content as StoredImage;
                  return (
                    <Message
                      key={m.id}
                      type="image"
                      model={{
                        direction,
                        position: 'single',
                        sender: m.senderId,
                        sentTime,
                      }}
                    >
                      <Message.ImageContent
                        src={img.url}
                        alt={img.name ?? 'image'}
                        width={240}
                      />
                    </Message>
                  );
                }

                // Non-image files → render as a download chip using
                // Message.CustomContent (CustomContent is just a flexible
                // container for arbitrary JSX inside a message bubble).
                // Audio files get an inline <audio> player — the UI kit
                // has no Message.AudioPlayer, so CustomContent is the
                // idiomatic escape hatch.
                if (m.contentType === MessageContentType.Attachment) {
                  const att = m.content as StoredAttachment;
                  const isAudio = att.mimeType?.startsWith('audio/');
                  const isLottie = att.lottieData !== undefined;

                  return (
                    <Message
                      key={m.id}
                      type="custom"
                      model={{
                        direction,
                        position: 'single',
                        sender: m.senderId,
                        sentTime,
                      }}
                    >
                      <Message.CustomContent>
                        {isLottie ? (
                          // Lottie animation renders inline. `loop` and
                          // `autoplay` are on by default, which matches
                          // the "gif-like" behaviour the user expects.
                          <Lottie
                            animationData={att.lottieData}
                            loop
                            autoplay
                            style={{ width: 240, height: 240 }}
                          />
                        ) : isAudio ? (
                          // Native HTML5 audio player. `controls` gives
                          // us play/pause/seek/volume for free.
                          <audio
                            controls
                            preload="metadata"
                            src={att.url}
                            style={{ width: '240px' }}
                          >
                            <source src={att.url} type={att.mimeType} />
                            Your browser doesn&apos;t support the audio
                            element.
                          </audio>
                        ) : (
                          <a
                            href={att.url}
                            download={att.name}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              textDecoration: 'none',
                            }}
                          >
                            <span role="img" aria-label="file">
                              📎
                            </span>
                            <span>
                              <strong>{att.name}</strong>
                              <br />
                              <small>{humanBytes(att.size)}</small>
                            </span>
                          </a>
                        )}
                      </Message.CustomContent>
                    </Message>
                  );
                }

                // Multiple-choice prompts ride on MessageContentType.Other.
                if (
                  m.contentType === MessageContentType.Other &&
                  isMultipleChoiceContent(m.content)
                ) {
                  const mc = m.content;
                  return (
                    <Message
                      key={m.id}
                      type="custom"
                      model={{
                        direction,
                        position: 'single',
                        sender: m.senderId,
                        sentTime,
                      }}
                    >
                      <Message.CustomContent>
                        <MultipleChoiceBubble
                          question={mc.question}
                          choices={mc.choices}
                          selectedIndex={mc.selectedIndex}
                          onSelect={(idx) => handleChoicePicked(m, idx)}
                        />
                      </Message.CustomContent>
                    </Message>
                  );
                }

                // Default: text/html.
                return (
                  <Message
                    key={m.id}
                    model={{
                      direction,
                      position: 'single',
                      message: String((m.content as HtmlContent).content ?? ''),
                      sentTime,
                      sender: m.senderId,
                    }}
                  />
                );
              })
            )}
          </MessageList>
          <MessageInput
            value={currentMessage ?? ''}
            onChange={(_innerHtml, textContent) =>
              setCurrentMessage(textContent)
            }
            placeholder={
              sessionState === 'Done'
                ? 'This session is closed.'
                : hasPendingMCQ
                ? 'Pick an answer above to continue…'
                : 'Type message here'
            }
            onSend={handleSend}
            onAttachClick={handleAttachClick}
            attachButton={true}
            disabled={inputLocked}
            attachDisabled={inputLocked}
            sendDisabled={inputLocked}
          />
        </ChatContainer>
      </MainContainer>

      {/* Demo controls: show the same MultipleChoiceBubble reused with
          different question/choice configurations. Drop these once you
          have a real source of multiple-choice prompts. */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          padding: '0.5rem 0',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          className="btn btn-sm btn-outline-primary"
          onClick={() =>
            sendMultipleChoice('How are you feeling today?', [
              'Great',
              'Okay',
              'Not so good',
            ])
          }
        >
          Demo: 3 choices
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline-primary"
          onClick={() =>
            sendMultipleChoice('Pick a deployment target', [
              'Staging',
              'Production EU',
              'Production US',
              'Skip for now',
            ])
          }
        >
          Demo: 4 choices
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline-primary"
          onClick={() =>
            sendMultipleChoice('Yes or no?', ['Yes', 'No'])
          }
        >
          Demo: 2 choices
        </button>

        {/* Session transition demo buttons. Replace these with whatever
            triggers the transition in your real app (system message,
            backend signal, etc.). */}
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          disabled={!activeConversation || sessionState === 'Done'}
          onClick={() =>
            activeConversation && markConversationDone(activeConversation.id)
          }
        >
          Demo: end session
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          // Restart is only available once the chat is Done. That's the
          // signal that the conversation is over and worth archiving —
          // we want a session-history entry per *completed* chat, not
          // per casual mid-conversation reset.
          disabled={!activeConversation || sessionState !== 'Done'}
          onClick={() =>
            activeConversation && restartConversation(activeConversation.id)
          }
        >
          Demo: restart
        </button>

        {/* Dev toggle for the localStorage inspector. Browsers don't
            offer a programmatic "open the storage drawer of DevTools",
            so the next-best thing is reading the same key we write to
            and showing it inline. */}
        <button
          type="button"
          className="btn btn-sm btn-outline-info"
          onClick={() => {
            setStorageTick((n) => n + 1); // force a fresh read on open
            setStorageOpen((open) => !open);
          }}
        >
          {storageOpen ? 'Hide local storage' : 'Show local storage'}
        </button>
      </div>

      {storageOpen && (
        <LocalStorageViewer
          tick={storageTick}
          onRefresh={() => setStorageTick((n) => n + 1)}
          onClear={() => {
            clearArchivedSessions();
            setStorageTick((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

/**
 * Dev-only inspector. Reads the same key sessionArchive writes to and
 * dumps it inline so you don't have to open DevTools to verify what's
 * being persisted. `tick` is a numeric prop bumped by the parent to
 * trigger a re-read after a write or clear.
 */
function LocalStorageViewer({
  tick,
  onRefresh,
  onClear,
}: {
  tick: number;
  onRefresh: () => void;
  onClear: () => void;
}) {
  // We re-read on every render. localStorage access is fast and the
  // panel is dev-only — no need for memoisation. `tick` is read so
  // React knows this component depends on it, even though we don't
  // use the value directly.
  void tick;
  const sessions = loadArchivedSessions();
  const raw = (() => {
    try {
      return window.localStorage.getItem('pioneo:chat-sessions:v1');
    } catch {
      return null;
    }
  })();

  return (
    <div
      style={{
        marginTop: '0.5rem',
        padding: '0.75rem',
        border: '1px solid rgba(0,0,0,0.15)',
        borderRadius: '0.5rem',
        background: 'rgba(0,0,0,0.02)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          marginBottom: '0.5rem',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
          pioneo:chat-sessions:v1{' '}
          <span style={{ opacity: 0.6, fontWeight: 400 }}>
            ({sessions.length}{' '}
            {sessions.length === 1 ? 'session' : 'sessions'})
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={onRefresh}
          >
            Refresh
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline-danger"
            disabled={sessions.length === 0}
            onClick={() => {
              if (
                window.confirm(
                  'Delete all archived sessions from localStorage?'
                )
              ) {
                onClear();
              }
            }}
          >
            Clear
          </button>
        </div>
      </div>

      <pre
        style={{
          maxHeight: '260px',
          overflow: 'auto',
          margin: 0,
          padding: '0.5rem',
          background: 'white',
          border: '1px solid rgba(0,0,0,0.1)',
          borderRadius: '0.25rem',
          fontSize: '0.75rem',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {raw ? JSON.stringify(JSON.parse(raw), null, 2) : '(empty)'}
      </pre>
    </div>
  );
}

/** Small pill that shows the active session state. Color coded so it's
 *  easy to verify the state machine while developing. */
function SessionStateBadge({ state }: { state: SessionState }) {
  const palette: Record<SessionState, { bg: string; fg: string }> = {
    Empty: { bg: 'rgba(0,0,0,0.06)', fg: 'rgba(0,0,0,0.55)' },
    Open: { bg: '#198754', fg: 'white' },
    Pending: { bg: '#fd7e14', fg: 'white' },
    Done: { bg: '#6c757d', fg: 'white' },
  };
  const { bg, fg } = palette[state];

  return (
    <div
      style={{
        display: 'inline-block',
        padding: '0.15rem 0.6rem',
        marginBottom: '0.4rem',
        borderRadius: '999px',
        background: bg,
        color: fg,
        fontSize: '0.75rem',
        fontWeight: 600,
        letterSpacing: '0.02em',
      }}
    >
      Session: {state}
    </div>
  );
}

function SideNav() {
  return (
    <>
      <div className="ChatList">
        <ol>
          <li className="list-group-item selected">Chat 1</li>
          <li className="list-group-item">Chat 2</li>
          <li className="list-group-item">Chat 3</li>
        </ol>
      </div>
    </>
  );
}

export { Chat };
export { SideNav };
