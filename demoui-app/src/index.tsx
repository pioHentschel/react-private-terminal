import './index.css';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Outlet, Route, Routes } from 'react-router-dom';

import {
  AutoDraft,
  BasicStorage,
  ChatProvider,
  IStorage,
  UpdateState,
} from '@chatscope/use-chat';
import { ExampleChatService } from '@chatscope/use-chat/dist/examples/ExampleChatService';

import { Chat } from './App';
// sessionArchive.ts is no longer used — session persistence was removed.

// Simple unique-id helpers used by BasicStorage to assign ids to messages
// and message groups. Swap these for uuid or nanoid later if you prefer.
const messageIdGenerator = () =>
  `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
const groupIdGenerator = () =>
  `grp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

// BasicStorage keeps users, conversations, messages, active conversation,
// and the current input draft in memory. Persist it yourself if you need
// messages to survive a reload.
const chatStorage = new BasicStorage({ groupIdGenerator, messageIdGenerator });

// The ChatProvider expects a factory that returns an IChatService.
// ExampleChatService is the ships-with-the-library reference implementation:
// it uses a window CustomEvent ("chat-protocol") as a fake transport so two
// browser tabs/components can "talk" to each other. For our purposes it's
// enough to make sendMessage work end-to-end; replace with your own service
// (WebSocket, REST, etc.) when you're ready.
const serviceFactory = (storage: IStorage, updateState: UpdateState) => {
  return new ExampleChatService(storage, updateState);
};

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <ChatProvider
    serviceFactory={serviceFactory}
    storage={chatStorage}
    config={{
      typingThrottleTime: 250,
      typingDebounceTime: 900,
      debounceTyping: true,
      autoDraft: AutoDraft.Save | AutoDraft.Restore,
    }}
  >
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Chat />} />
          {/* Value has to change to display a different chat */}
        </Route>
      </Routes>
    </BrowserRouter>
  </ChatProvider>
);

export default function Layout() {
  return (
    <>
      <Outlet />
    </>
  );
}
