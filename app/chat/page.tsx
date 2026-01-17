import ChatInterface from '@/components/ChatInterface';

export default function ChatPage() {
  return (
    <div className="h-screen flex flex-col">
      <header className="border-b border-muted/20 p-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-semibold text-foreground">Edgelands Chat</h1>
          <a
            href="/"
            className="text-muted hover:text-foreground transition-colors text-sm"
          >
            ← Back to Dashboard
          </a>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <div className="h-full max-w-5xl mx-auto">
          <ChatInterface />
        </div>
      </main>
    </div>
  );
}
