import React, { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronRight,
  Code2,
  Eye,
  FileClock,
  FolderCog,
  HardDrive,
  MonitorSmartphone,
  ShieldCheck,
  Sparkles,
  Zap
} from 'lucide-react'

const GITHUB_URL = 'https://github.com/ozlerege/AgentPanel'
const DOWNLOAD_URL = `${GITHUB_URL}/releases/download/v0.1.2/Desmos-Agent-0.1.2-arm64.dmg`

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

function AppleLogo({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 814 1000" width={size * 0.814} height={size} fill="currentColor" aria-hidden="true">
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
    </svg>
  )
}

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

  return (
    <>
      <div className="noise" aria-hidden="true" />
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Desmos Agent home">
          <img src="/app-icon.png" alt="" />
          <span>Desmos Agent</span>
        </a>
        <nav className="nav-links" aria-label="Main navigation">
          <a className="button button-small button-dark" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">
            <AppleLogo size={13} /> Download for Mac
          </a>
        </nav>
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
                <AppleLogo size={17} /> Download for Mac
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
            <AppleLogo size={18} /> Download for Mac <ChevronRight size={17} />
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
