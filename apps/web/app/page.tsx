const channels = ["ventneuf-os", "ampel", "brandstamp"];

function VentneufMark() {
  return <div className="brand-mark">29</div>;
}

export default function Home() {
  return (
    <main className="workspace-shell">
      <aside className="workspace-rail" aria-label="Workspaces">
        <VentneufMark />
        <button className="rail-avatar" type="button" aria-label="Your private space">
          Y
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
          <div>
            <span className="eyebrow">Private conversation</span>
            <h1>Hermes</h1>
          </div>
          <div className="header-actions">
            <span className="status-pill">Cloud connected</span>
            <button type="button" aria-label="Conversation settings">
              ···
            </button>
          </div>
        </header>

        <div className="message-stream">
          <div className="day-divider"><span>Today</span></div>
          <article className="message hermes-message">
            <div className="message-avatar">H</div>
            <div>
              <div className="message-meta">
                <strong>Hermes</strong>
                <span>Control plane</span>
              </div>
              <p>
                The workspace foundation is ready. The next connection will route this
                conversation through the authenticated ventneuf.os control plane to my private
                A2A endpoint in the private control plane.
              </p>
              <div className="capability-row">
                <span>Knowledge</span>
                <span>Missions</span>
                <span>Devices</span>
                <span>Connectors</span>
              </div>
            </div>
          </article>
        </div>

        <div className="composer-wrap">
          <form className="composer">
            <textarea
              aria-label="Message Hermes"
              placeholder="Ask Hermes to investigate, plan, or launch a mission…"
              rows={2}
              disabled
            />
            <div className="composer-footer">
              <span>Authentication and A2A connection are the next implementation step.</span>
              <button type="submit" disabled>Send</button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
