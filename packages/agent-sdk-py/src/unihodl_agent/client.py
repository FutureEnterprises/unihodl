"""UNIHODL Agent Handoff SDK — Python client.

Quickstart::

    import os
    from unihodl_agent import Client
    from anthropic import Anthropic

    uh = Client(api_key=os.environ["UNIHODL_API_KEY"])
    claude = Anthropic()

    ctx = uh.sessions.hydrate("ses_8f3aZ91b")
    resp = claude.messages.create(
        model="claude-sonnet-4-7",
        max_tokens=2048,
        system=ctx.as_system_prompt(),
        messages=[{"role": "user", "content": "Continue Sarah's research."}],
    )
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Sequence

import httpx

DEFAULT_BASE_URL = "https://www.unihodl.app/api"

Scope = Literal[
    "read:context",
    "read:reasoning",
    "read:redacted",
    "read:transcript",
    "write:notes",
    "write:next_step",
    "session:hand_off",
]

ReasoningNodeKind = Literal[
    "observation",
    "partial_conclusion",
    "decision_stance",
    "blocker",
    "question",
    "next_step",
    "reference",
]


class UnihodlError(Exception):
    """Standard error envelope from the SDK API."""

    def __init__(
        self,
        code: str,
        status: int,
        message: str,
        audit_id: Optional[str] = None,
        hint: Optional[str] = None,
    ):
        super().__init__(message)
        self.code = code
        self.status = status
        self.audit_id = audit_id
        self.hint = hint


@dataclass
class ReasoningNode:
    id: str
    kind: ReasoningNodeKind
    text: str
    evidence: Optional[List[str]] = None
    supports: Optional[List[str]] = None
    depends_on: Optional[List[str]] = None
    confidence: Optional[float] = None


@dataclass
class ResumeTab:
    url: str
    title: str
    scroll_y_pct: Optional[float] = None
    selected_text: Optional[str] = None
    tab_role: Optional[str] = None


@dataclass
class ResumeMedia:
    kind: Literal["video", "audio", "image"]
    url: str
    timestamp_s: Optional[int] = None
    transcript_anchor: Optional[str] = None


@dataclass
class ResumeContext:
    session_id: str
    version: str
    captured_at: str
    title: str
    summary: str
    tabs: List[ResumeTab] = field(default_factory=list)
    media: List[ResumeMedia] = field(default_factory=list)
    reasoning_thread: List[ReasoningNode] = field(default_factory=list)
    ai_tags: List[str] = field(default_factory=list)
    redactions: List[Dict[str, str]] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ResumeContext":
        return cls(
            session_id=data["session_id"],
            version=data.get("version", "1.0"),
            captured_at=data["captured_at"],
            title=data.get("title", ""),
            summary=data.get("summary", ""),
            tabs=[ResumeTab(**t) for t in data.get("tabs", [])],
            media=[ResumeMedia(**m) for m in data.get("media", [])],
            reasoning_thread=[
                ReasoningNode(**n) for n in data.get("reasoning_thread", [])
            ],
            ai_tags=list(data.get("ai_tags", [])),
            redactions=list(data.get("redactions", [])),
        )


class HydratedContext:
    """Wrapper around ResumeContext with prompt-rendering helpers."""

    def __init__(self, ctx: ResumeContext):
        self.raw = ctx

    @property
    def text(self) -> str:
        return self.as_system_prompt()

    def as_system_prompt(self) -> str:
        """Render the Resume Context as a structured natural-language block.

        The output is the same prompt-ready format described in spec §6.
        Drop it directly into a Claude `system` prompt or a Gemini
        `system_instruction`.
        """
        ctx = self.raw
        lines: List[str] = []
        lines.append(
            f"## CONTEXT (UNIHODL session {ctx.session_id} · "
            f"{ctx.captured_at[:10]})\n"
        )
        lines.append(f'The user is researching: "{ctx.title}."\n')

        concl = [
            n
            for n in ctx.reasoning_thread
            if n.kind in ("observation", "partial_conclusion")
        ]
        if concl:
            lines.append("What they have concluded:")
            for n in concl:
                conf = (
                    f" (confidence {n.confidence:.2f})"
                    if n.confidence is not None
                    else ""
                )
                lines.append(f"  • {n.text}{conf}")
            lines.append("")

        stance = next(
            (n for n in ctx.reasoning_thread if n.kind == "decision_stance"),
            None,
        )
        if stance:
            lines.append("Where they currently lean:")
            lines.append(f"  → {stance.text}\n")

        blockers = [n for n in ctx.reasoning_thread if n.kind == "blocker"]
        if blockers:
            lines.append("Open blockers:")
            for b in blockers:
                lines.append(f"  ! {b.text}")
            lines.append("")

        next_step = next(
            (n for n in ctx.reasoning_thread if n.kind == "next_step"), None
        )
        if next_step:
            lines.append("Intended next step:")
            lines.append(f"  → {next_step.text}\n")

        if ctx.tabs or ctx.media:
            lines.append(
                f"Sources they consulted ({len(ctx.tabs)} tabs, "
                f"{len(ctx.media)} video):"
            )
            for i, t in enumerate(ctx.tabs, start=1):
                lines.append(f"  [{i}] {t.url} — {t.title}")
            for m in ctx.media:
                lines.append(f"  [v] {m.url}")
            lines.append("")

        lines.append("Continue from here.")
        return "\n".join(lines)

    def to_dict(self) -> Dict[str, Any]:
        from dataclasses import asdict

        return asdict(self.raw)


class _ResumeTokensApi:
    def __init__(self, client: "Client"):
        self._client = client

    def create(
        self,
        *,
        session_id: str,
        audience: str,
        scopes: Sequence[Scope],
        ttl_seconds: Optional[int] = None,
        max_hydrations: Optional[int] = None,
        redaction_policy: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "session_id": session_id,
            "audience": audience,
            "scopes": list(scopes),
        }
        if ttl_seconds is not None:
            body["ttl_seconds"] = ttl_seconds
        if max_hydrations is not None:
            body["max_hydrations"] = max_hydrations
        if redaction_policy is not None:
            body["redaction_policy"] = redaction_policy
        return self._client._request_json("POST", "/v1/resume_tokens", json=body)

    def revoke(self, jti: str, reason: Optional[str] = None) -> Dict[str, Any]:
        body: Dict[str, Any] = {}
        if reason is not None:
            body["reason"] = reason
        return self._client._request_json(
            "POST", f"/v1/resume_tokens/{jti}/revoke", json=body
        )


class _SessionsApi:
    def __init__(self, client: "Client"):
        self._client = client

    def hydrate(
        self,
        session_id: str,
        *,
        token: Optional[str] = None,
        audience: str = "sdk.unihodl.app",
        scopes: Sequence[Scope] = ("read:context", "read:reasoning"),
        ttl_seconds: int = 600,
        format: Literal["json", "prompt-ready"] = "json",
    ) -> HydratedContext:
        if token is None:
            minted = self._client.resume_tokens.create(
                session_id=session_id,
                audience=audience,
                scopes=scopes,
                ttl_seconds=ttl_seconds,
                max_hydrations=1,
            )
            token = minted["token"]

        headers = {"authorization": f"Bearer {token}"}
        if format == "prompt-ready":
            headers["x-unihodl-format"] = "prompt-ready"

        if format == "prompt-ready":
            text = self._client._request_text(
                "POST",
                f"/v1/sessions/{session_id}/hydrate",
                headers=headers,
            )
            return HydratedContext(
                ResumeContext(
                    session_id=session_id,
                    version="1.0",
                    captured_at="",
                    title=text.split("\n")[1] if text else "",
                    summary=text,
                    reasoning_thread=[],
                )
            )

        data = self._client._request_json(
            "POST",
            f"/v1/sessions/{session_id}/hydrate",
            headers=headers,
        )
        return HydratedContext(ResumeContext.from_dict(data))

    def get(self, session_id: str) -> Dict[str, Any]:
        """Fetch session metadata. Auth via API key (no resume token)."""
        return self._client._request_json("GET", f"/v1/sessions/{session_id}")

    def append_note(
        self, session_id: str, body_text: str, *, token: str
    ) -> Dict[str, Any]:
        """Append an agent-authored note. Requires write:notes scope on token."""
        headers = {"authorization": f"Bearer {token}"}
        return self._client._request_json(
            "POST",
            f"/v1/sessions/{session_id}/notes",
            json={"body": body_text},
            headers=headers,
        )

    def handoff(
        self,
        session_id: str,
        *,
        audience: str,
        scopes: Sequence[Scope],
        step_up_timestamp: int,
        ttl_seconds: int = 600,
        delegator_user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Transfer a session to another principal. Requires step-up auth."""
        body: Dict[str, Any] = {
            "audience": audience,
            "scopes": list(scopes),
            "ttl_seconds": ttl_seconds,
        }
        if delegator_user_id is not None:
            body["delegator_user_id"] = delegator_user_id
        return self._client._request_json(
            "POST",
            f"/v1/sessions/{session_id}/handoff",
            json=body,
            headers={"x-unihodl-stepup": str(step_up_timestamp)},
        )

    def capture(
        self,
        *,
        session_id: str,
        title: str,
        summary: str = "",
        tabs: Optional[List[Dict[str, Any]]] = None,
        media: Optional[List[Dict[str, Any]]] = None,
        reasoning_thread: Optional[List[Dict[str, Any]]] = None,
        ai_tags: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Capture a session from a non-extension source."""
        return self._client._request_json(
            "POST",
            "/v1/hodl",
            json={
                "session_id": session_id,
                "title": title,
                "summary": summary,
                "tabs": tabs or [],
                "media": media or [],
                "reasoning_thread": reasoning_thread or [],
                "ai_tags": ai_tags or [],
            },
        )


class Client:
    """The Agent Handoff SDK client.

    :param api_key: UNIHODL API key starting with ``uh_test_`` or ``uh_live_``.
    :param base_url: Override the API base URL. Default
        ``https://www.unihodl.app/api``.
    :param timeout_s: Per-request timeout in seconds. Default ``30``.
    """

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout_s: float = 30.0,
    ):
        if not api_key:
            raise ValueError("unihodl-agent: api_key is required")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._http = httpx.Client(timeout=timeout_s)
        self.resume_tokens = _ResumeTokensApi(self)
        self.sessions = _SessionsApi(self)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "Client":
        return self

    def __exit__(self, *_exc: Any) -> None:
        self.close()

    # --- internals -------------------------------------------------------

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        json: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        resp = self._send(method, path, json=json, headers=headers)
        return resp.json()

    def _request_text(
        self,
        method: str,
        path: str,
        *,
        json: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> str:
        resp = self._send(method, path, json=json, headers=headers)
        return resp.text

    def _send(
        self,
        method: str,
        path: str,
        *,
        json: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> httpx.Response:
        merged = {"authorization": f"Bearer {self._api_key}"}
        if headers:
            merged.update(headers)
        resp = self._http.request(
            method,
            f"{self._base_url}{path}",
            json=json,
            headers=merged,
        )
        if resp.status_code >= 400:
            try:
                body = resp.json()
                err = body.get("error", {})
            except Exception:
                err = {}
            raise UnihodlError(
                code=err.get("code", "http_error"),
                status=resp.status_code,
                message=err.get("message", f"HTTP {resp.status_code}"),
                audit_id=err.get("audit_id"),
                hint=err.get("hint"),
            )
        return resp
