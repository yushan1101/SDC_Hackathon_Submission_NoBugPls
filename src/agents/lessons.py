"""Small, explicit lessons used when the learning designer is unavailable.

These teach concepts rather than substituting a skill name into generic advice.
External resources still come exclusively from retrieved evidence.
"""
import re


CATALOG = {
    "design": [
        ("Visual Hierarchy", "Size, contrast and position guide the order in which people read a layout. Give the most important message the strongest emphasis.",
         "A workshop poster puts the event name first, the date second and registration details last.",
         "Create two poster layouts using the same words. Change the heading size and placement; ask someone which message they notice first.",
         "Two annotated poster layouts showing the intended reading order.", "Which change most clearly establishes a primary heading?", ["Make its size and contrast stronger than the supporting text.", "Give every line the same size and emphasis."]),
        ("Color and Contrast", "Contrast separates information from its background. Color can reinforce meaning, but labels or shapes should carry the meaning too.",
         "An error uses an icon and the word 'Error' as well as red, so its meaning survives grayscale.",
         "Create a light and dark version of a small information card. Check that labels remain readable in grayscale and identify anything conveyed by color alone.",
         "Two readable information cards with a contrast and grayscale review.", "How should a warning convey its meaning?", ["Use a clear text label or icon alongside color.", "Use red alone without a label."]),
        ("Spacing and Alignment", "Related items should sit closer together than unrelated groups. A shared alignment edge helps readers scan a layout.",
         "A form groups each label with its input, then leaves a larger gap before the next field group.",
         "Redesign a cluttered form or flyer using one alignment edge and consistent spacing. Annotate three grouping decisions.",
         "A before-and-after layout with three spacing annotations.", "Which spacing makes a label's relationship clear?", ["Keep the label closer to its own field than to other groups.", "Use identical gaps between every item regardless of meaning."]),
        ("Translating a Design Brief", "A brief defines the audience, message, constraints and intended action. A design decision should support one of those requirements.",
         "A sign-up poster for first-time visitors needs a clear invitation, venue and next action before decorative details.",
         "Write a four-line brief for a workplace poster, then create a layout. Label how the headline, imagery and call to action meet the brief.",
         "A poster and brief with three design decisions linked to requirements.", "What should guide a layout decision first?", ["The audience and intended action in the brief.", "A decorative trend unrelated to the message."]),
    ],
    "sql": [
        ("Selecting and Filtering Rows", "SELECT chooses columns; WHERE keeps rows matching a condition. Filtering changes which records reach your result.",
         "SELECT customer, total FROM orders WHERE total > 100 returns only orders above 100.",
         "Create a five-row orders table with customer and total columns. Write a query selecting orders above 100 and predict the result before running it.",
         "The sample rows, query, predicted output and actual output.", "Which clause restricts rows before aggregation?", ["WHERE", "ORDER BY"]),
        ("Grouping and Aggregating", "GROUP BY creates one group per distinct key. SUM and COUNT summarize each group; include the grouping key in the result so the totals are interpretable.",
         "SELECT region, SUM(total) FROM orders GROUP BY region produces one sales total per region.",
         "Add two regions to your sample orders. Calculate regional totals by hand, write a GROUP BY query and reconcile its output with your calculation.",
         "A grouped query and a reconciliation of its totals.", "What does GROUP BY region produce with SUM(total)?", ["One total for each region.", "One unchanged output row for every order."]),
        ("Joining Tables Safely", "A join combines rows using a key. Duplicate keys can multiply rows, so check the expected relationship and compare counts before trusting totals.",
         "Joining orders to customers on customer_id adds a name; two customer rows with the same ID would duplicate an order.",
         "Create customers and orders samples. Join them by customer_id, introduce one duplicate customer ID, and explain the change in row count.",
         "Two join outputs with a row-count check and duplicate-key explanation.", "Why can a joined total be too high?", ["Duplicate matching keys can multiply rows.", "A join always removes duplicates automatically."]),
        ("Handling Missing Values", "NULL represents missing or unknown data. Test it with IS NULL; a missing value is different from zero and from an empty string.",
         "WHERE delivered_at IS NULL finds orders with no recorded delivery date.",
         "Add a missing date to sample orders. Compare IS NULL with a normal equality filter and explain how missing values should appear in a report.",
         "A missing-value query and a short reporting rule.", "Which expression finds missing delivery dates?", ["delivered_at IS NULL", "delivered_at = NULL"]),
    ],
    "data": [
        ("Checking Data Quality", "Check missing values, duplicate records and impossible values before interpreting a dataset. Record each rule so another person can repeat the check.",
         "A sales sheet with negative quantities and repeated order IDs needs review before its totals become a performance report.",
         "Build a ten-row sample dataset containing a duplicate, a blank and an impossible value. Flag each problem and propose a correction without deleting evidence.",
         "An annotated dataset and a three-rule quality checklist.", "What should happen before interpreting a total?", ["Check the input records and document data-quality issues.", "Hide unusual rows without recording why."]),
        ("Choosing a Chart for a Question", "Choose the chart from the comparison: bars compare categories, lines show ordered time, and a scatter plot explores relationships. Label units and keep the scale honest.",
         "A monthly trend fits a line chart; comparing five teams at one date usually fits a bar chart.",
         "State one workplace question, sketch two chart options for the same small dataset and explain which answers the question more clearly.",
         "Two labeled chart sketches and a written selection rationale.", "Which chart best shows change across consecutive months?", ["A line chart with an ordered time axis.", "An unlabeled collection of category slices."]),
        ("Explaining an Insight with Evidence", "Separate the observation, interpretation and recommended action. A pattern supports a question or hypothesis; it does not automatically prove its cause.",
         "'Response time rose in June' is an observation. 'Staffing caused it' needs additional evidence.",
         "Write a three-sentence stakeholder update using one chart: what changed, what remains uncertain, and one action to investigate or improve it.",
         "A chart and a three-sentence evidence-based update.", "What can a correlation establish by itself?", ["A relationship worth investigating, without proving causation.", "Proof that one variable caused the other."]),
    ],
    "communication": [
        ("Structuring a Clear Message", "Lead with the reader's decision or need, support it with a concrete fact, then state the requested action and timing.",
         "'Please approve the revised schedule by Friday; the supplier moved delivery to Monday' is easier to act on than a long unexplained history.",
         "Rewrite a fictional workplace update in under 100 words. Include one main message, supporting evidence and an explicit next action.",
         "An original and revised update with the main message and action highlighted.", "Which ending makes an update actionable?", ["Please approve option B by Friday.", "Please see the information above."]),
        ("Listening and Clarifying", "Paraphrasing checks your understanding before you respond. Ask an open question about an unclear requirement, then confirm the agreed next step.",
         "'You need the report before the client call; which two figures are essential?' checks both timing and scope.",
         "Write a short client conversation containing an ambiguous request, a paraphrase, two clarification questions and a confirmed next step.",
         "A conversation script with the final agreement highlighted.", "What should you do with an ambiguous request?", ["Check your understanding and clarify the missing detail.", "Assume the request means what you would prefer."]),
        ("Giving Specific Feedback", "Describe an observable action, explain its effect, and agree a useful next step. Comments about someone's character give them less to improve.",
         "'The report omitted the date range, so I could not compare the totals; add it to the heading' names a fix.",
         "Turn three vague feedback statements into observation-effect-next-step statements for a workplace task.",
         "Three specific feedback statements and a proposed follow-up.", "Which feedback is more useful?", ["Name the missing date range and ask for it in the heading.", "Say the author is careless without an example."]),
    ],
    "creative": [
        ("Reframing a Problem", "A useful problem statement identifies who needs help and what blocks their goal. Reframing changes the question before you choose a solution.",
         "'We need an app' becomes 'Visitors need to find the right desk without asking three people.'",
         "Write three different 'How might we' questions for one workplace problem. Compare the assumptions each question makes.",
         "Three problem frames and a reason for choosing one.", "What makes a useful problem frame?", ["It describes a person's need without prematurely choosing a solution.", "It assumes the first proposed tool must be the answer."]),
        ("Generating and Comparing Ideas", "Separate idea generation from evaluation. First create alternatives; then compare them against explicit criteria such as usefulness, effort and constraints.",
         "A team lists six ways to reduce waiting before scoring them against cost and ease of use.",
         "Generate six solutions to a small workplace problem. Score three against two stated criteria and explain your choice.",
         "An idea list and a scored shortlist.", "When should you evaluate alternatives?", ["After generating options, using stated criteria.", "Reject every unfamiliar idea before recording it."]),
    ],
    "ai": [
        ("Writing a Task-Specific AI Prompt", "Give the tool a goal, relevant context, constraints and an output format. Do not include confidential data unless your workplace explicitly permits that use.",
         "'Summarize these fictional support notes as issue, evidence and next step; mark uncertain details' gives a checkable format.",
         "Use fictional workplace notes to write a constrained prompt. Compare two outputs and list missing or unsupported claims.",
         "A prompt, two outputs and an accuracy checklist.", "What makes an AI result usable at work?", ["Verify claims against the source and review the result for the task.", "Assume fluent text is evidence that every claim is correct."]),
        ("Verifying AI Output", "A generated answer may be plausible and wrong. Trace factual claims to the original material, test calculations and keep uncertain claims visibly uncertain.",
         "A summary that invents a deadline must be corrected by checking the original message.",
         "Draft a fictional AI summary with two deliberate mistakes. Check it against its source notes, correct both errors and record the checks.",
         "A corrected summary and a claim-by-claim verification note.", "How should an unsupported deadline be handled?", ["Check the original source and remove or qualify the unsupported date.", "Keep the date because it sounds plausible."]),
    ],
}


def lesson_for(skill: str, week: int, current: float, resources=()):
    name = skill.casefold()
    family = next((family for family, pattern in [
        ("sql", r"sql|database|query"), ("design", r"design|typograph|layout|color|colour"),
        ("data", r"data|analytic|chart|dashboard|excel|statistic"),
        ("creative", r"creativ|brainstorm|ideation|concept develop"),
        ("ai", r"\bai\b|artificial intelligence|prompt"),
        ("communication", r"communicat|listen|feedback|writ|present|lead|supervis|teamwork|collaborat"),
    ] if re.search(pattern, name)), None)
    if family:
        catalog = CATALOG[family]
        return catalog[(week - 1 + int(current // 2)) % len(catalog)]
    excerpts = [" ".join(getattr(resource, "excerpt", "").split())[:700] for resource in resources if getattr(resource, "excerpt", "")]
    explanation = excerpts[0] if excerpts else f"Break {skill} into an input, an action and an observable result. Compare your result with an explicit task requirement before calling the work finished."
    return (f"Applying {skill} to a Task", explanation,
            f"For a task involving {skill}, record what you received, the action you chose, and what changed in the output.",
            f"Select a small task requiring {skill}. Write its acceptance criteria, perform it, and annotate two decisions using the retrieved guide or your workplace procedure.",
            f"A completed {skill} task with acceptance criteria and two annotated decisions.",
            f"How can you check the result of a task involving {skill}?",
            ["Compare its output with the stated acceptance criteria and record evidence.", "Mark it complete without inspecting the result."])
