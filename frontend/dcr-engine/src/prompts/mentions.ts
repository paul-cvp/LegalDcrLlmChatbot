const mentionPrompt = `
# Task

You are a business process modeling expert, tasked with identifying mentions of process relevant events and actors in law texts. 
The text is given sentence by sentence, with a sentence identifier (e.g., Sentence 0), which you should refer to when doing the task.
You can find a definition below.

# Definition

{{description}}

## Restrictions

Rule 1: Don't extract Events, that are not process relevant, i.e., they describe a state someone or something is in (e.g. waiting).

Rule 2: Don't extract an Event, if it describes the process lifecycle (e.g. process end, start, etc.)

# Format

For each mention you detect, write a line in the following format:

<text>\t<type>\t<sentence>\t<role>

## Placeholders

- <text>: the text of the mention
- <type>: type of the mention, either Event or Actor
- <sentence>: integer, that identifies the sentence where the mention text was found in the input. Zero based.
- <role>: for Actors, exactly one of Citizen, Caseworker, or Robot; leave empty for Events.

Normalize applicants and members of the public to Citizen, automated systems to Robot,
and all administrative or otherwise unknown actors to Caseworker.

## Format Example

Sentence 0: The first step is to complete the report .
Sentence 1: then the clerk will review it .

complete the report\tEvent\t0\t
review it\tEvent\t1\t
the clerk\tActor\t1\tCaseworker

# Notes

Do not change the text you extract, i.e., do not correct typos, or change spaces, or add punctuation.
Do not use any code formatting.

# Example

Given the textual description:

0: (13) Passengers whose flights are cancelled should be able either to obtain reimbursement of their tickets or to obtain re-routing under satisfactory conditions, and should be adequately cared for while awaiting a later flight.

You are expected to extract:

Passengers\tActor\t0\tCitizen
flights are cancelled\tEvent\t0\t
obtain reimbursement of their tickets\tEvent\t0\t
obtain re-routing under satisfactory conditions\tEvent\t0\t
should be adequately cared for\tEvent\t0\t

# The text

{{text}}
`;

export default mentionPrompt;
