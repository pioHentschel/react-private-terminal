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
  MessageContentType,
  MessageDirection,
  MessageStatus,
  Participant,
  Presence,
  User,
  UserStatus,
  useChat,
} from '@chatscope/use-chat';

const CURRENT_USER_ID = 'me';
const DEFAULT_CONVERSATION_ID = 'chat-1';

// ── Attachment helpers ───────────────────────────────────────────────────────

type AttachmentExtra = {
  name: string;
  size: number;
  mimeType: string;
  lottieData?: unknown;
};
type StoredAttachment = AttachmentContent & AttachmentExtra;
type StoredImage     = ImageContent     & AttachmentExtra;

function isLottieJson(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return typeof o.v === 'string' && Array.isArray(o.layers);
}

function readJsonFile(file: File): Promise<unknown | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      try { resolve(JSON.parse(String(reader.result))); }
      catch { resolve(null); }
    };
    reader.readAsText(file);
  });
}

function humanBytes(bytes: number): string {
  if (bytes < 1024)            return `${bytes} B`;
  if (bytes < 1024 * 1024)    return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── List state ───────────────────────────────────────────────────────────────

// All lists stored by name → items. Kept in component state; resets on reload.
type ListStore = Record<string, string[]>;

// ── Chat component ───────────────────────────────────────────────────────────

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
    currentMessage,
    setCurrentMessage,
    removeMessagesFromConversation,
  } = useChat();

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // All named lists and which one is currently active.
  const [lists, setLists]                     = useState<ListStore>({});
  const [activeListName, setActiveListName]   = useState<string | null>(null);

  // One-time bootstrap: seed user + conversation so sendMessage has a target.
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
          description: 'Terminal',
        })
      );
    }

    setActiveConversation(DEFAULT_CONVERSATION_ID);
  }, []);

  // Auto-focus the input on mount.
  useEffect(() => {
    const editor = document.querySelector<HTMLElement>(
      '.cs-message-input__content-editor'
    );
    editor?.focus();
  }, []);

  // Push a system response into the conversation.
  const sendSystemMessage = (text: string) => {
    if (!activeConversation) return;
    sendMessage({
      message: new ChatMessage({
        id: '',
        content: { content: text } as HtmlContent,
        contentType: MessageContentType.TextHtml,
        senderId: 'system',
        direction: MessageDirection.Incoming,
        status: MessageStatus.Sent,
      }),
      conversationId: activeConversation.id,
      senderId: 'system',
      generateId: true,
    });
  };

  const handleSend = (_innerHtml: string, textContent: string) => {
    if (!activeConversation) return;

    const trimmed = textContent.trim();
    if (!trimmed) return;

    // Echo the typed command into the message list.
    sendMessage({
      message: new ChatMessage({
        id: '',
        content: { content: trimmed } as HtmlContent,
        contentType: MessageContentType.TextHtml,
        senderId: CURRENT_USER_ID,
        direction: MessageDirection.Outgoing,
        status: MessageStatus.Sent,
      }),
      conversationId: activeConversation.id,
      senderId: CURRENT_USER_ID,
      generateId: true,
    });
    setCurrentMessage('');

    // ── Command parsing ──────────────────────────────────────────────────────

    if (trimmed.startsWith('mklist ')) {
      const name = trimmed.slice(7).trim();
      if (!name) { sendSystemMessage('Usage: mklist [name]'); return; }
      setLists(prev => ({ ...prev, [name]: prev[name] ?? [] }));
      setActiveListName(name);
      sendSystemMessage(`List "${name}" created.`);

    } else if (trimmed.startsWith('add ')) {
      const item = trimmed.slice(4).trim();
      if (!item) { sendSystemMessage('Usage: add [item]'); return; }
      if (!activeListName) {
        sendSystemMessage('No active list. Create one first with: mklist [name]');
        return;
      }
      setLists(prev => ({ ...prev, [activeListName]: [...(prev[activeListName] ?? []), item] }));
      sendSystemMessage(`Added "${item}" to "${activeListName}".`);

    } else if (trimmed.startsWith('rm ')) {
      const item = trimmed.slice(3).trim();
      if (!item) { sendSystemMessage('Usage: rm [item]'); return; }
      if (!activeListName) {
        sendSystemMessage('No active list. Create one first with: mklist [name]');
        return;
      }
      if (!(lists[activeListName] ?? []).includes(item)) {
        sendSystemMessage(`"${item}" not found in "${activeListName}".`);
        return;
      }
      setLists(prev => ({ ...prev, [activeListName]: prev[activeListName].filter(i => i !== item) }));
      sendSystemMessage(`Removed "${item}" from "${activeListName}".`);

    } else if (trimmed.startsWith('view ')) {
      const name = trimmed.slice(5).trim();
      if (!name) { sendSystemMessage('Usage: view [list name]'); return; }
      if (!(name in lists)) {
        sendSystemMessage(`List "${name}" does not exist.`);
        return;
      }
      const items = lists[name];
      if (items.length === 0) {
        sendSystemMessage(`${name} — (empty)`);
      } else {
        sendSystemMessage(`${name} [${items.length}]:<br>${items.map(i => `&nbsp;&nbsp;${i}`).join('<br>')}`);
      }

    } else if (trimmed.startsWith('swap ')) {
      const name = trimmed.slice(5).trim();
      if (!name) { sendSystemMessage('Usage: swap [list name]'); return; }
      if (!(name in lists)) {
        sendSystemMessage(`List "${name}" does not exist. Use mklist to create it.`);
        return;
      }
      setActiveListName(name);
      sendSystemMessage(`Switched to "${name}".`);

    } else if (trimmed.startsWith('del ')) {
      const name = trimmed.slice(4).trim();
      if (!name) { sendSystemMessage('Usage: del [list name]'); return; }
      if (!(name in lists)) {
        sendSystemMessage(`List "${name}" does not exist.`);
        return;
      }
      setLists(prev => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      if (activeListName === name) setActiveListName(null);
      sendSystemMessage(`Deleted "${name}".`);

    } else if (trimmed === 'show lists') {
      const names = Object.keys(lists);
      if (names.length === 0) {
        sendSystemMessage('No lists yet. Use mklist [name] to create one.');
      } else {
        sendSystemMessage(`Lists [${names.length}]:<br>${names.map(n => `&nbsp;&nbsp;${n} (${lists[n].length} items)`).join('<br>')}`);
      }

    } else if (trimmed === 'clear') {
      removeMessagesFromConversation(activeConversation.id);
      setCurrentMessage('');

    } else if (trimmed === 'help') {
      sendSystemMessage(
        'Utility commands:<br>' +
        '&nbsp;&nbsp;help&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;— show this help<br>' +
        '&nbsp;&nbsp;clear&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;— clear all text from the terminal<br>' +
        '<br>' +
        'List commands:<br>' +
        '&nbsp;&nbsp;mklist [name]&nbsp;&nbsp;&nbsp;&nbsp;— create a new list<br>' +
        '&nbsp;&nbsp;add [item]&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;— add an item to the active list<br>' +
        '&nbsp;&nbsp;rm [item]&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;— remove an item from the active list<br>' +
        '&nbsp;&nbsp;view [name]&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;— display all items in a list<br>' +
        '&nbsp;&nbsp;swap [name]&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;— switch the active list<br>' +
        '&nbsp;&nbsp;del [name]&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;— delete a list and its contents<br>' +
        '&nbsp;&nbsp;show lists&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;— display all list names'
      );

    } else {
      sendSystemMessage(
        `Unknown command: "${trimmed}". Type help for a list of commands.`
      );
    }
  };

  const handleAttachClick = () => fileInputRef.current?.click();

  const handleFilesPicked: React.ChangeEventHandler<HTMLInputElement> = async (evt) => {
    if (!activeConversation) return;
    const files = evt.target.files;
    if (!files || files.length === 0) return;
    const conversationId = activeConversation.id;

    for (const file of Array.from(files)) {
      const url          = URL.createObjectURL(file);
      const isImage      = file.type.startsWith('image/');
      const looksLikeJson =
        file.type === 'application/json' ||
        file.name.toLowerCase().endsWith('.json');

      let lottieData: unknown | undefined;
      if (looksLikeJson) {
        const parsed = await readJsonFile(file);
        if (isLottieJson(parsed)) lottieData = parsed;
      }

      const extra: AttachmentExtra = { name: file.name, size: file.size, mimeType: file.type, lottieData };
      const content = isImage
        ? ({ url, data: new ArrayBuffer(0), ...extra } as StoredImage)
        : ({ url, data: new ArrayBuffer(0), ...extra } as StoredAttachment);

      sendMessage({
        message: new ChatMessage({
          id: '',
          content,
          contentType: isImage ? MessageContentType.Image : MessageContentType.Attachment,
          senderId: CURRENT_USER_ID,
          direction: MessageDirection.Outgoing,
          status: MessageStatus.Sent,
        }),
        conversationId,
        senderId: CURRENT_USER_ID,
        generateId: true,
      });
    }

    evt.target.value = '';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFilesPicked}
      />

      {/* Active list indicator */}
      <div className="terminal-header">
        <span className="terminal-header__label">list:</span>
        <span className="terminal-header__value">
          {activeListName ?? '—'}
        </span>
      </div>

      <MainContainer>
        <ChatContainer className="MyChatContainer">
          <MessageList className="message-list">
            {currentMessages.flatMap((group) =>
              group.messages.map((m) => {
                const direction = 'incoming' as const;
                const sentTime  = m.createdTime?.toLocaleTimeString() ?? 'just now';

                if (m.contentType === MessageContentType.Image) {
                  const img = m.content as StoredImage;
                  return (
                    <Message key={m.id} type="image" model={{ direction, position: 'single', sender: m.senderId, sentTime }}>
                      <Message.ImageContent src={img.url} alt={img.name ?? 'image'} width={240} />
                    </Message>
                  );
                }

                if (m.contentType === MessageContentType.Attachment) {
                  const att     = m.content as StoredAttachment;
                  const isAudio  = att.mimeType?.startsWith('audio/');
                  const isLottie = att.lottieData !== undefined;

                  return (
                    <Message key={m.id} type="custom" model={{ direction, position: 'single', sender: m.senderId, sentTime }}>
                      <Message.CustomContent>
                        {isLottie ? (
                          <Lottie animationData={att.lottieData} loop autoplay style={{ width: 240, height: 240 }} />
                        ) : isAudio ? (
                          <audio controls preload="metadata" src={att.url} style={{ width: '240px' }}>
                            <source src={att.url} type={att.mimeType} />
                            Your browser doesn&apos;t support the audio element.
                          </audio>
                        ) : (
                          <a href={att.url} download={att.name} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none', color: '#00ff00' }}>
                            <span role="img" aria-label="file">📎</span>
                            <span><strong>{att.name}</strong><br /><small>{humanBytes(att.size)}</small></span>
                          </a>
                        )}
                      </Message.CustomContent>
                    </Message>
                  );
                }

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
            onChange={(_innerHtml, textContent) => setCurrentMessage(textContent)}
            placeholder=""
            onSend={handleSend}
            onAttachClick={handleAttachClick}
            attachButton={true}
          />
        </ChatContainer>
      </MainContainer>
    </div>
  );
}

export { Chat };
