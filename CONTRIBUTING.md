# Contributing to InTandem

InTandem is an early-stage project. Contributions are welcome — whether it's a bug fix, feature, test, or documentation improvement.

## Getting Started

```bash
git clone https://github.com/sourabh-khot65/tandem.git
cd tandem
npm install
npm run build
npm test        # 179 tests, all should pass
```

## Development Workflow

```bash
npm run dev           # watch mode (recompiles on save)
npm run build         # full compile
npm test              # run vitest
npm run lint          # typecheck + format check
npm run format        # auto-format with Prettier
```

Code quality is enforced via git hooks:

- **pre-commit**: Prettier formatting + TypeScript type check
- **commit-msg**: [Conventional Commits](https://www.conventionalcommits.org/) required (`fix:`, `feat:`, `chore:`, etc.)

## Project Structure

```
src/
  channel/    MCP server, WebSocket client, tool handlers
  hub/        WebSocket hub, SQLite persistence
  shared/     Protocol types, cryptography, configuration
  cli.ts      CLI entrypoint
tests/
  unit/       Crypto, DB, connection tests
  integration/ Hub protocol, collaboration, handler tests
```

## Making Changes

1. **Fork and branch** from `main`
2. **Write tests** for new functionality — we aim for coverage on all hub and channel logic
3. **Run `npm test`** before pushing
4. **Keep commits atomic** — one logical change per commit
5. **Open a PR** with a clear description of what and why

## Areas Where Help Is Needed

Check issues labeled [`good first issue`](https://github.com/sourabh-khot65/tandem/labels/good%20first%20issue) for entry points. Bigger areas:

- **Connection reliability** — replace localtunnel with cloudflared
- **Tool delegation** — let peers execute tools on each other's behalf
- **Agent spawning** — integrate with Claude Code's native Agent tool
- **Local-only mode** — Unix socket or file-based IPC for same-machine peers
- **More tests** — especially for channel/server.ts (MCP transport layer)

## Code Style

- TypeScript strict mode, ESM modules
- Prettier for formatting (runs automatically on commit)
- No unnecessary abstractions — keep it simple
- Comments only where the logic isn't self-evident

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
