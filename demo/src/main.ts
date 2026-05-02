import './styles.css'

type Capability = {
  title: string
  copy: string
  command: string
}

const capabilities: Capability[] = [
  {
    title: 'Author Once',
    copy: 'Keep the canonical agent brief in one source file, then build the right prompt and config shape for every harness.',
    command: 'npx iso build .',
  },
  {
    title: 'Route Models',
    copy: 'Compile role-level model policy into each supported agent environment without forking the workflow prose.',
    command: 'npx iso-route build models.yaml',
  },
  {
    title: 'Audit Runs',
    copy: 'Replay transcripts, extract facts, score outcomes, redact secrets, and enforce policy from deterministic local tools.',
    command: 'npx iso-trace parse transcript.json',
  },
]

const packages = [
  'agentmd',
  'isolint',
  'iso-harness',
  'iso-route',
  'iso-context',
  'iso-cache',
  'iso-index',
  'iso-facts',
  'iso-guard',
  'iso-eval',
  'iso-trace',
  'iso-redact',
]

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Missing #app root')
}

app.innerHTML = `
  <section class="hero">
    <nav class="topbar" aria-label="Primary">
      <a class="brand" href="https://github.com/razroo/iso" target="_blank" rel="noreferrer">
        <img src="./logo.svg" alt="ISO" />
      </a>
      <div class="navlinks">
        <a href="#pipeline">Pipeline</a>
        <a href="#packages">Packages</a>
        <a href="https://github.com/razroo/iso" target="_blank" rel="noreferrer">GitHub</a>
      </div>
    </nav>

    <div class="heroGrid">
      <div class="heroCopy">
        <p class="eyebrow">Razroo agent workflow toolchain</p>
        <h1>Write AI agent instructions once. Run them anywhere.</h1>
        <p class="lede">
          ISO turns a single authored source into Claude Code, Codex, Cursor, OpenCode, and Pi harnesses,
          then closes the loop with deterministic context, routing, scoring, tracing, redaction, and policy checks.
        </p>
        <div class="actions">
          <a class="primary" href="https://github.com/razroo/iso" target="_blank" rel="noreferrer">View Repo</a>
          <a class="secondary" href="#pipeline">Explore Demo</a>
        </div>
      </div>

      <div class="terminal" aria-label="ISO command preview">
        <div class="terminalChrome">
          <span></span><span></span><span></span>
        </div>
        <pre><code>$ npx iso build .

✓ agent.md validated
✓ prose rewritten for smaller models
✓ models.yaml routed
✓ harness files generated

outputs:
  CLAUDE.md
  AGENTS.md
  .codex/config.toml
  .cursor/rules/iso.mdc
  .opencode/agents/default.md
  .pi/prompts/default.md</code></pre>
      </div>
    </div>
  </section>

  <section class="band" id="pipeline">
    <div class="sectionHead">
      <p class="eyebrow">Portable by default</p>
      <h2>One workflow, multiple agent surfaces.</h2>
    </div>
    <div class="capabilityGrid">
      ${capabilities.map((item) => `
        <article class="capability">
          <h3>${item.title}</h3>
          <p>${item.copy}</p>
          <code>${item.command}</code>
        </article>
      `).join('')}
    </div>
  </section>

  <section class="band packageBand" id="packages">
    <div class="sectionHead">
      <p class="eyebrow">Modular runtime control</p>
      <h2>Build-time harnesses plus feedback tools.</h2>
    </div>
    <div class="packageCloud">
      ${packages.map((name) => `<span>@razroo/${name}</span>`).join('')}
    </div>
  </section>
</main>
`
