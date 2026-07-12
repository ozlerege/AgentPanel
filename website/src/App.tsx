import React, { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronRight,
  Code2,
  Download,
  Eye,
  FileClock,
  FolderCog,
  HardDrive,
  Menu,
  MonitorSmartphone,
  ShieldCheck,
  Sparkles,
  X,
  Zap
} from 'lucide-react'

const GITHUB_URL = 'https://github.com/ozlerege/AgentPanel'
const DOWNLOAD_URL = `${GITHUB_URL}/releases/download/v0.1.0/Desmos-Agent-0.1.0-arm64.dmg`

const features = [
  {
    icon: FolderCog,
    number: '01',
    title: 'One place for every resource',
    body: 'Browse agents, skills, MCP servers, commands, and instructions across Codex and Claude Code without digging through hidden folders.'
  },
  {
    icon: ShieldCheck,
    number: '02',
    title: 'Safe edits, every time',
    body: 'Preview diffs, validate changes, and keep automatic backups before anything touches your configuration.'
  },
  {
    icon: Eye,
    number: '03',
    title: 'Full native fidelity',
    body: 'Use friendly fields or inspect the source. Unknown keys and comments stay intact, exactly where they belong.'
  },
  {
    icon: Zap,
    number: '04',
    title: 'Usage at a glance',
    body: 'See local session activity, token totals, and available Codex limits without making a model call.'
  },
  {
    icon: FileClock,
    number: '05',
    title: 'Backups you can trust',
    body: 'Every change is recorded locally, so accidental edits and deletes are easy to understand and restore.'
  },
  {
    icon: HardDrive,
    number: '06',
    title: 'Local by design',
    body: 'No account, cloud sync, or hosted database. Your agent configuration stays on your Mac.'
  }
]

const resourceNames = ['AGENTS', 'SKILLS', 'MCP SERVERS', 'COMMANDS', 'INSTRUCTIONS', 'PLUGINS', 'HOOKS', 'PROJECTS']

function useReveal() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add('is-visible')),
      { threshold: 0.12 }
    )
    const nodes = document.querySelectorAll('.reveal')
    nodes.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [])
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeShot, setActiveShot] = useState<'overview' | 'agents'>('overview')
  const heroWindow = useRef<HTMLDivElement>(null)
  useReveal()

  useEffect(() => {
    const el = heroWindow.current
    if (!el) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let heroVisible = true
    let frame = 0
    let pointerX = 0
    let pointerY = 0
    const observer = new IntersectionObserver(([entry]) => {
      heroVisible = entry.isIntersecting
    })
    observer.observe(el)
    const update = () => {
      frame = 0
      const rect = el.getBoundingClientRect()
      const x = (pointerX - rect.left) / rect.width - 0.5
      const y = (pointerY - rect.top) / rect.height - 0.5
      el.style.setProperty('--rx', `${-y * 2.4}deg`)
      el.style.setProperty('--ry', `${x * 3.4}deg`)
    }
    const handlePointer = (event: PointerEvent) => {
      if (!heroVisible || reduceMotion.matches) return
      pointerX = event.clientX
      pointerY = event.clientY
      if (!frame) frame = requestAnimationFrame(update)
    }
    window.addEventListener('pointermove', handlePointer, { passive: true })
    return () => {
      window.removeEventListener('pointermove', handlePointer)
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  const closeMenu = () => setMenuOpen(false)

  return (
    <>
      <div className="noise" aria-hidden="true" />
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Desmos Agent home" onClick={closeMenu}>
          <img src="/app-icon.png" alt="" />
          <span>Desmos Agent</span>
        </a>
        <nav className={menuOpen ? 'nav-links open' : 'nav-links'} aria-label="Main navigation">
          <a href="#features" onClick={closeMenu}>Features</a>
          <a href="#screens" onClick={closeMenu}>Screens</a>
          <a href="#privacy" onClick={closeMenu}>Local first</a>
          <a className="nav-github" href={GITHUB_URL} target="_blank" rel="noreferrer">
            <Code2 size={17} /> GitHub
          </a>
          <a className="button button-small button-dark" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">
            Download for Mac
          </a>
        </nav>
        <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-label="Toggle navigation">
          {menuOpen ? <X /> : <Menu />}
        </button>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-glow" aria-hidden="true" />
          <div className="hero-copy">
            <div className="eyebrow hero-in hero-in-1">
              <span className="status-dot" /> Built for Codex + Claude Code
            </div>
            <h1 className="hero-in hero-in-2">Your agents.<br /><span>Under control.</span></h1>
            <p className="hero-subtitle hero-in hero-in-3">
              The local control panel for everything behind your AI coding tools. Manage configs, track usage, and make safer changes—without touching a terminal.
            </p>
            <div className="hero-actions hero-in hero-in-4">
              <a className="button button-primary" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">
                <Download size={19} /> Download for Mac
              </a>
              <a className="button button-ghost" href={GITHUB_URL} target="_blank" rel="noreferrer">
                <Code2 size={19} /> View on GitHub
              </a>
            </div>
            <div className="compatibility hero-in hero-in-5">
              <Check size={14} /> macOS 13+ <span /> Apple Silicon <span /> Free and open source
            </div>
          </div>

          <div className="hero-product hero-in hero-in-4" ref={heroWindow}>
            <div className="window-topbar">
              <div className="traffic-lights"><i /><i /><i /></div>
              <span>Desmos Agent</span>
              <div className="window-status"><i /> Local only</div>
            </div>
            <img src="/screenshots/overview.png" alt="Desmos Agent overview showing Codex and Claude Code usage" />
            <div className="floating-chip chip-one"><Sparkles size={14} /> Both providers detected</div>
            <div className="floating-chip chip-two"><ShieldCheck size={14} /> Configs stay local</div>
          </div>
        </section>

        <section className="resource-strip" aria-label="Supported resources">
          <div className="resource-track">
            {[...resourceNames, ...resourceNames].map((name, index) => (
              <React.Fragment key={`${name}-${index}`}><span>{name}</span><i>✦</i></React.Fragment>
            ))}
          </div>
        </section>

        <section className="section intro-section reveal" id="features">
          <div className="section-label"><span>01</span> CONTROL CENTER</div>
          <div className="section-heading">
            <h2>Complex configs.<br /><em>One calm interface.</em></h2>
            <p>Desmos Agent turns a maze of files and formats into a clear, native workspace—while preserving the details power users care about.</p>
          </div>

          <div className="feature-grid">
            {features.map(({ icon: Icon, number, title, body }) => (
              <article className="feature-card" key={title}>
                <div className="feature-top"><Icon size={22} /><span>{number}</span></div>
                <h3>{title}</h3>
                <p>{body}</p>
                <div className="feature-line" />
              </article>
            ))}
          </div>
        </section>

        <section className="section showcase reveal" id="screens">
          <div className="section-label light"><span>02</span> THE APP</div>
          <div className="showcase-head">
            <h2>See the whole system.<br /><em>Change only what you mean to.</em></h2>
            <div className="shot-tabs" role="tablist" aria-label="Application screenshots">
              <button className={activeShot === 'overview' ? 'active' : ''} onClick={() => setActiveShot('overview')} role="tab" aria-selected={activeShot === 'overview'}>Usage overview</button>
              <button className={activeShot === 'agents' ? 'active' : ''} onClick={() => setActiveShot('agents')} role="tab" aria-selected={activeShot === 'agents'}>Agent inspector</button>
            </div>
          </div>
          <div className="showcase-window">
            <div className="window-topbar dark-bar">
              <div className="traffic-lights"><i /><i /><i /></div>
              <span>{activeShot === 'overview' ? 'Local usage overview' : 'Codex agent inspector'}</span>
              <div className="window-status"><i /> Live preview</div>
            </div>
            <div className="shot-stage">
              <img key={activeShot} loading="lazy" decoding="async" src={`/screenshots/${activeShot}.png`} alt={activeShot === 'overview' ? 'Codex and Claude usage dashboard' : 'Agent resource inspector with fields and source'} />
            </div>
          </div>
        </section>

        <section className="section local-section reveal" id="privacy">
          <div className="local-copy">
            <div className="section-label"><span>03</span> LOCAL FIRST</div>
            <h2>Your configuration<br />is <em>your configuration.</em></h2>
            <p>Desmos Agent reads and writes the files already on your Mac. There is no hosted account, no database to trust, and no new cloud in the middle.</p>
            <ul>
              <li><Check size={16} /> No sign-up or API key required</li>
              <li><Check size={16} /> No telemetry or cloud sync</li>
              <li><Check size={16} /> Automatic local backups</li>
              <li><Check size={16} /> Source available on GitHub</li>
            </ul>
            <a className="text-link" href={`${GITHUB_URL}#readme`} target="_blank" rel="noreferrer">Explore the source <ArrowRight size={16} /></a>
          </div>
          <div className="local-visual" aria-label="Diagram showing that configuration remains on this Mac">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <div className="local-core">
              <img src="/app-icon.png" alt="" />
              <strong>ON THIS MAC</strong>
              <span>~/.codex · ~/.claude</span>
            </div>
            <div className="provider-node node-codex"><Code2 size={19} /> Codex</div>
            <div className="provider-node node-claude"><Sparkles size={19} /> Claude Code</div>
            <div className="provider-node node-project"><MonitorSmartphone size={19} /> Your projects</div>
          </div>
        </section>

        <section className="cta-section reveal">
          <div className="cta-grid" aria-hidden="true" />
          <img src="/app-icon.png" alt="Desmos Agent icon" />
          <h2>Less config wrangling.<br /><em>More building.</em></h2>
          <p>Get one calm, local workspace for the tools you use every day.</p>
          <a className="button button-primary button-large" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">
            <Download size={20} /> Download for Mac <ChevronRight size={17} />
          </a>
          <span className="cta-note">Free · Open source · macOS 13+</span>
        </section>
      </main>

      <footer>
        <a className="brand" href="#top"><img src="/app-icon.png" alt="" /><span>Desmos Agent</span></a>
        <p>Made for people who take their agents seriously.</p>
        <div><a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a><a href={`${GITHUB_URL}/issues`} target="_blank" rel="noreferrer">Issues</a><a href={`${GITHUB_URL}/releases`} target="_blank" rel="noreferrer">Releases</a></div>
      </footer>
    </>
  )
}
