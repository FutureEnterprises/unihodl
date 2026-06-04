"""unihodl-agent — UNIHODL Agent Handoff SDK for Python.

The decision-continuity protocol for human-to-agent and agent-to-agent
work transfer. Pass a UNIHODL resume token to any AI agent and the
agent receives the human's open tabs, scroll positions, video
timestamps, AI-tagged decision thread, partial conclusions, and
intended next step.

Spec: https://unihodl.app/sdk/spec
Roadmap: https://unihodl.app/sdk/roadmap
"""

from .client import (
    Client,
    HydratedContext,
    ResumeContext,
    ReasoningNode,
    ResumeTab,
    ResumeMedia,
    UnihodlError,
)

__version__ = "0.2.0"

__all__ = [
    "Client",
    "HydratedContext",
    "ResumeContext",
    "ReasoningNode",
    "ResumeTab",
    "ResumeMedia",
    "UnihodlError",
    "__version__",
]
