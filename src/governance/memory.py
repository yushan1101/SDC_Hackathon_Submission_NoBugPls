"""Per-account agent memory: short facts the agent learns about one person, carried into every later chat.

The agent writes them itself: its reply may end with `REMEMBER: <fact>` / `FORGET: <id>` lines, which are stripped
before the person sees the reply. Each account only ever sees and feeds its own facts; the person can list, delete or
clear them in Settings."""
import re
from datetime import datetime, timezone

MAX_FACTS = 60    # ponytail: oldest-unused facts drop off past this; summarise into fewer facts if people hit it
MAX_LEN = 220
PER_REPLY = 3     # new facts one reply may add

DDL = """CREATE TABLE IF NOT EXISTS agent_memory(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL,
         fact TEXT NOT NULL, agent TEXT, created_utc TEXT, used_utc TEXT);
         CREATE INDEX IF NOT EXISTS agent_memory_user ON agent_memory(username);"""

PROMPT = ("You have a long-term memory of this person across all their chats: <MEMORY> lists what you learned before, "
          "each fact with its id. Use it actively: connect what they say now to their goals, background, constraints, "
          "past decisions and progress; notice change over time; point out patterns and contradictions; tailor every "
          "recommendation to them rather than giving generic advice, and say briefly which remembered fact you are "
          "building on when it matters. Do not recite the memory back unprompted. "
          "After your reply, on separate final lines, you may add up to 3 lines `REMEMBER: <one short fact>` for "
          "durable things worth knowing next time (goals, role, experience, skills and levels, constraints such as time "
          "or budget, preferences for how to learn or be advised, decisions taken, results achieved). Never store "
          "passwords, ID or card numbers, health details or other sensitive personal data, and never store guesses. "
          "If a remembered fact is now wrong or outdated, add `FORGET: <id>` (and REMEMBER the corrected fact). "
          "Add nothing if nothing durable came up. These lines are hidden from the person.")

_LINE = re.compile(r"^\s*[-*]?\s*(REMEMBER|FORGET)\s*:\s*(.+?)\s*$", re.I | re.M)
_SECRET = re.compile(r"password|passcode|\b\d{12,19}\b|\bcvv\b|api[_ -]?key|token", re.I)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def init(con) -> None:
    con.executescript(DDL)


def recall(con, username: str) -> list[dict]:
    rows = con.execute("SELECT id, fact, created_utc FROM agent_memory WHERE username=? ORDER BY id", (username,)).fetchall()
    return [{"id": i, "fact": f, "since": (c or "")[:10]} for i, f, c in rows]


def for_prompt(con, username: str) -> str:
    facts = recall(con, username)
    if facts:
        con.execute("UPDATE agent_memory SET used_utc=? WHERE username=?", (_now(), username))
    body = "\n".join(f"[{f['id']}] ({f['since']}) {f['fact']}" for f in facts) or "Nothing yet: this is your first chat with them."
    return f"<MEMORY>\n{body}\n</MEMORY>\n"


def split(reply: str) -> tuple[str, list[str], list[int]]:
    """-> (reply without memory lines, facts to remember, ids to forget)."""
    keep, forget = [], []
    for kind, val in _LINE.findall(reply):
        if kind.upper() == "REMEMBER":
            keep.append(val.strip().strip("`\"'")[:MAX_LEN])
        else:
            forget += [int(x) for x in re.findall(r"\d+", val)]
    return _LINE.sub("", reply).strip(), keep[:PER_REPLY], forget


def apply(con, username: str, agent: str, remember: list[str], forget: list[int]) -> None:
    if forget:
        con.execute(f"DELETE FROM agent_memory WHERE username=? AND id IN ({','.join('?' * len(forget))})", (username, *forget))
    have = {f.lower() for (f,) in con.execute("SELECT fact FROM agent_memory WHERE username=?", (username,))}
    now = _now()
    for fact in remember:
        if len(fact) < 4 or fact.lower() in have or _SECRET.search(fact):
            continue
        con.execute("INSERT INTO agent_memory(username, fact, agent, created_utc, used_utc) VALUES(?,?,?,?,?)",
                    (username, fact, agent, now, now))
        have.add(fact.lower())
    over = con.execute("SELECT COUNT(*) FROM agent_memory WHERE username=?", (username,)).fetchone()[0] - MAX_FACTS
    if over > 0:
        con.execute("DELETE FROM agent_memory WHERE id IN (SELECT id FROM agent_memory WHERE username=? "
                    "ORDER BY used_utc, id LIMIT ?)", (username, over))


def forget_one(con, username: str, fact_id: int) -> bool:
    return con.execute("DELETE FROM agent_memory WHERE username=? AND id=?", (username, fact_id)).rowcount > 0


def clear(con, username: str) -> int:
    return con.execute("DELETE FROM agent_memory WHERE username=?", (username,)).rowcount


if __name__ == "__main__":  # self-check: python -m governance.memory
    import sqlite3
    con = sqlite3.connect(":memory:")
    init(con)
    text, rem, fg = split("Here is your plan.\nREMEMBER: Wants to move into data analysis by mid-2027\nREMEMBER: my password is x\nFORGET: 7")
    assert text == "Here is your plan." and len(rem) == 2 and fg == [7], (text, rem, fg)
    apply(con, "a", "coach", rem, [])
    assert [f["fact"] for f in recall(con, "a")] == ["Wants to move into data analysis by mid-2027"]  # the password line is dropped
    assert recall(con, "b") == []
    fid = recall(con, "a")[0]["id"]
    apply(con, "a", "coach", ["Prefers short evening lessons"], [fid])
    assert [f["fact"] for f in recall(con, "a")] == ["Prefers short evening lessons"]
    print("ok")
