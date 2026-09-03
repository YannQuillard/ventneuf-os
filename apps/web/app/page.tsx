import { readSession } from "../lib/auth/session";
import { HermesConversation } from "./conversation";

const channels = ["ventneuf-os", "ampel", "brandstamp"];

function VentneufMark() {
  return <div className="brand-mark">29</div>;
}

export default async function Home() {
  const session = await readSession();

  if (!session) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <VentneufMark />
          <span className="eyebrow">Agentic workspace</span>
          <h1>Welcome to ventneuf.os</h1>
          <p>Sign in to access your conversations, knowledge, missions, and connected devices.</p>
          <a className="login-button" href="/auth/login">Sign in</a>
        </section>
      </main>
    );
  }

  const initial = session.email.slice(0, 1).toUpperCase();

  return (
    <main className="workspace-shell">
      <aside className="workspace-rail" aria-label="Workspaces">
        <VentneufMark />
        <button className="rail-avatar" type="button" aria-label="Your private space">
          {initial}
        </button>
      </aside>

      <aside className="channel-sidebar">
        <header className="workspace-heading">
          <span>ventneuf</span>
          <span className="online-dot" title="Control plane online" />
        </header>

        <nav aria-label="Conversations">
          <p className="section-label">Private</p>
          <a className="channel active" href="#hermes">
            <span className="hermes-glyph">H</span>
            Hermes
          </a>

          <p className="section-label">Projects</p>
          {channels.map((channel) => (
            <a className="channel" href={`#${channel}`} key={channel}>
              <span className="hash">#</span>
              {channel}
            </a>
          ))}
        </nav>

        <div className="device-card">
          <span className="device-status" />
          <div>
            <strong>This Mac</strong>
            <span>Runner setup pending</span>
          </div>
        </div>
      </aside>

      <section className="conversation" id="hermes">
        <header className="conversation-header">
          <div className="conversation-identity">
            <span className="conversation-avatar">H</span>
            <div>
              <h1>Hermes</h1>
              <span className="conversation-presence"><i /> Cloud agent online</span>
            </div>
          </div>
          <div className="header-actions">
            <span className="account-email">{session.email}</span>
            <a className="logout-link" href="/auth/logout">Sign out</a>
            <button type="button" aria-label="Conversation settings">
              ···
            </button>
          </div>
        </header>

        <HermesConversation userInitial={initial} />
      </section>
    </main>
  );
}
