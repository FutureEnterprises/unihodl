# unihodl-agent

The Python SDK for the **UNIHODL Agent Handoff SDK** — the
decision-continuity protocol for human-to-agent and agent-to-agent
work transfer.

Pass a UNIHODL resume token to any AI agent. The agent receives the
human's open tabs, scroll positions, video timestamps, AI-tagged
decision thread, partial conclusions, and intended next step — not
just a list of links.

**Spec:** https://unihodl.app/sdk/spec
**Roadmap & open gaps:** https://unihodl.app/sdk/roadmap

## Install

```bash
pip install unihodl-agent
```

## Quickstart

```python
import os
from unihodl_agent import Client
from anthropic import Anthropic

uh = Client(api_key=os.environ["UNIHODL_API_KEY"])
claude = Anthropic()

# Hydrate the session into a structured Resume Context.
ctx = uh.sessions.hydrate("ses_8f3aZ91b")

resp = claude.messages.create(
    model="claude-sonnet-4-7",
    max_tokens=2048,
    system=ctx.as_system_prompt(),
    messages=[{"role": "user", "content": "Continue Sarah's research."}],
)
```

## Status

This is **v0.1.0** — public preview matching spec v1.0. Known gaps are
tracked publicly at https://unihodl.app/sdk/roadmap.

## License

MIT
