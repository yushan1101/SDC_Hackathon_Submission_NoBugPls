"""Quick-match MCQ game: 12 work scenarios -> O*NET skill levels (0-5) + a field-interest filter.

Each option is a self-assessed behaviour anchored to O*NET level descriptions (1 basic ... 4 advanced). The result
is a coarse profile for a fast prediction; the resume path gives the evidence-backed deep analysis.
"""
FIELDS = {
    "health": ("Health & care", ["29", "31", "21"]),
    "tech": ("Software, data & IT", ["15"]),
    "engineering": ("Engineering & science", ["17", "19"]),
    "business": ("Business, finance & management", ["11", "13"]),
    "education": ("Teaching & training", ["25"]),
    "creative": ("Arts, media & design", ["27"]),
    "trades": ("Building, repair & installation", ["47", "49"]),
    "production": ("Manufacturing & production", ["51"]),
    "transport": ("Transport & logistics", ["53"]),
    "service": ("Hospitality, retail & personal services", ["35", "37", "39", "41"]),
    "office": ("Office & administration", ["43"]),
    "public": ("Law, safety & public service", ["23", "33"]),
    "land": ("Farming, fishing & environment", ["45"]),
}

# O*NET Job Zones: how much preparation a role needs (2 high school ... 5 graduate degree)
TRAINING = [("High school or less", 2), ("Vocational training, apprenticeship or associate degree", 3),
            ("Bachelor's degree", 4), ("Master's, doctorate or professional degree", 5)]

QUESTIONS = [
    ("manual", "A 20-page guide arrives for a new system you must use next week. You…",
     ["Reading Comprehension"], ["Wait for someone to walk you through it", "Skim for the parts you need",
                                 "Read it and follow it without help", "Spot the gaps and brief your team on them"]),
    ("email", "Your manager asks for a one-page update on a messy project. You…",
     ["Writing"], ["Ask a colleague to write it", "Write a list of facts", "Write a clear page people can act on",
                   "Write it so well it gets forwarded to leadership"]),
    ("numbers", "A spreadsheet total looks wrong. You…",
     ["Mathematics"], ["Flag it and move on", "Re-add the column by hand", "Trace the formula and fix it",
                       "Rebuild the model with checks so it can't happen again"]),
    ("code", "A repetitive task eats an hour every day. You…",
     ["Programming"], ["Keep doing it by hand", "Record a macro or use a template", "Write a small script for it",
                       "Build a tool the whole team now uses"]),
    ("upset", "Someone arrives upset and talking fast. You…",
     ["Active Listening", "Social Perceptiveness"], ["Point them to someone else", "Let them finish, then answer",
                                                     "Reflect back what you heard and ask questions",
                                                     "Read what is really wrong and calm the room"]),
    ("pitch", "You have five minutes to convince a group to change a habit. You…",
     ["Speaking", "Persuasion"], ["Avoid presenting", "Read from notes", "Explain it clearly and take questions",
                                  "Win over the sceptics in the room"]),
    ("decide", "Two sources give you conflicting information. You…",
     ["Critical Thinking", "Judgment and Decision Making"], ["Pick the one you saw first", "Ask someone which is right",
                                                             "Compare the evidence and decide", "Weigh the risks, decide, and explain why"]),
    ("broken", "A machine, device or system stops working mid-shift. You…",
     ["Troubleshooting", "Repairing"], ["Call support and wait", "Restart it and check the obvious",
                                        "Find the faulty part and fix it", "Fix it and change the routine so it doesn't fail again"]),
    ("crew", "Three people need to finish a job by Friday. You…",
     ["Coordination", "Management of Personnel Resources", "Time Management"],
     ["Do your own part", "Agree who does what", "Plan the week and keep everyone on track",
      "Rebalance the work as problems appear and still land it"]),
    ("customer", "A customer asks for something outside the usual process. You…",
     ["Service Orientation"], ["Say it's not possible", "Pass it to a supervisor", "Find a way to help within the rules",
                               "Solve it and improve the process for the next person"]),
    ("teach", "A new colleague joins and is lost. You…",
     ["Instructing", "Learning Strategies"], ["Leave it to their manager", "Answer when asked",
                                              "Show them step by step", "Build a short guide others now use to onboard"]),
    ("science", "Something at work behaves in a way you don't understand. You…",
     ["Science", "Active Learning"], ["Ignore it if it still works", "Search for a quick answer",
                                      "Test a few ideas to find the cause", "Design a proper test and share what you learned"]),
    ("monitor", "You run a process all day (a line, a ward, a server, a vehicle). You…",
     ["Monitoring", "Operation and Control"], ["Follow the checklist only", "Check readings when reminded",
                                               "Watch the key signs and adjust", "Catch problems early that others miss"]),
]


def questions() -> dict:
    return {"fields": [{"id": k, "label": v[0]} for k, v in FIELDS.items()],
            "training": [{"label": t, "zone": z} for t, z in TRAINING],
            "questions": [{"id": q, "prompt": p, "skills": s, "options": o} for q, p, s, o in QUESTIONS]}


def score(answers: dict[str, int], fields: list[str]) -> tuple[dict[str, int], list[str]]:
    """answers {question_id: option index 0-3} -> ({skill: level 1-4}, soc_prefixes). Unknown ids ignored."""
    levels = {}
    for qid, _, skills, opts in QUESTIONS:
        if qid in answers and 0 <= int(answers[qid]) < len(opts):
            for s in skills:
                levels[s] = max(levels.get(s, 0), int(answers[qid]) + 1)
    prefixes = [p for f in fields if f in FIELDS for p in FIELDS[f][1]]
    return levels, prefixes


if __name__ == "__main__":
    lv, px = score({"broken": 3, "monitor": 2, "crew": 1}, ["trades"])
    assert lv["Repairing"] == 4 and lv["Coordination"] == 2 and px == ["47", "49"], (lv, px)
    print("ok")
