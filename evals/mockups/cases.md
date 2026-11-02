# Mock-up cases

Each case is one request to the workshop agent, with what he pointed at. `words`: only words change, so the mock-up must keep the element's look. `structure`: the change needs new parts, in the app's own style. `none`: a question, where no mock-up is right. Every case also checks: no code edits, the mock-up on the right element, and the time to the first beat. Must show uses patterns (`|` means or).

| id              | kind      | page       | target           | he says                                                                        | must show                                        | must keep                             |
| --------------- | --------- | ---------- | ---------------- | ------------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------- |
| euros-real-1    | words     | /request   | amount           | Uh, how would th-this look in, uh, euros?                                      | €, 3 4\|3 5                                      | Amount, input box                     |
| euros-real-2    | words     | /request   | amount (circled) | How is look in euros?                                                          | €, 3 4\|3 5                                      | Amount, input box                     |
| dollars-real    | words     | /request   | amount           | Dollars                                                                        | $, 3 [6-9]\|4 0                                  | Amount, input box                     |
| ingrid-real     | words     | /request   | status           | What does the status mean here, and how would it look if it waited for Ingrid? | Ingrid                                           | the pill's dot and shape              |
| kr-after        | words     | /request   | amount           | What if the kroner came after the number?                                      | 40 000 kr                                        | Amount, input box                     |
| title-short     | words     | /request   | title            | Make this shorter, how would that look                                         | Kari Nordmann                                    | the asker line under it, heading size |
| title-norsk     | words     | /request   | title            | How would the title look in Norwegian?                                         | Bonus til Kari Nordmann\|Bonus for Kari Nordmann | heading size                          |
| button-name     | words     | /request   | submit           | What if this said who it goes to?                                              | Ola Hansen                                       | blue button, its size class           |
| asker-date      | words     | /request   | asker            | Show the real date instead of two days ago                                     | Ola Hansen, 20[0-9]{2}\|Oct\|Nov\|okt\|\d+\.     | small grey text                       |
| role-order      | words     | /request   | approvers        | Could the role say who approves first?                                         | first                                            | the grey rows, names                  |
| status-approved | words     | /request   | status           | How does this look once it is approved?                                        | Approved                                         | pill shape                            |
| sent-time       | words     | /sent      | sent             | Put the time it was sent in here                                               | [0-9]{1,2}[:.][0-9]{2}                           | grey paragraph                        |
| tab-rename      | words     | /request   | tab-approvers    | How would it look if this tab was called People?                               | People                                           | tab style                             |
| add-label       | words     | /approvers | add              | Make the add button say add last                                               | last                                             | button style                          |
| converted-under | structure | /request   | amount           | Can we show euros too, small under it?                                         | €, NOK 40 000                                    | Amount, input box                     |
| third-approver  | structure | /request   | approvers        | How would it look with a third approver, from HR?                              | HR, Ola Hansen, Ingrid Berg                      | grey rows, Approvers label            |
| urgent-badge    | structure | /request   | title            | What if urgent ones had a little badge here?                                   | Urgent\|urgent                                   | heading, asker line                   |
| status-steps    | structure | /request   | status           | Show the status as steps, one per approver                                     | Ola\|Ingrid                                      | small size: no bigger than the row    |
| button-disabled | structure | /request   | submit           | How would the button look if it could not be sent yet?                         | Send for approval                                | button size                           |
| what-status     | none      | /request   | status           | What does this status mean?                                                    | -                                                | -                                     |
| who-ingrid      | none      | /approvers | approver-list    | Who is Ingrid?                                                                 | -                                                | -                                     |
| why-blue        | none      | /request   | submit           | Why is this blue?                                                              | -                                                | -                                     |

Notes:

- **euros-real-1**: NOK 40 000 is about €3 450. The input box, its border and size stay.
- **euros-real-2**: The failure that started this eval.
- **dollars-real**: One word, while pointing at the amount: show it in US dollars, about $3 700 to $4 000.
- **ingrid-real**: Answer in one beat, then mock the pill with Ingrid's name. Same pill.
- **title-short**: A shorter title, same heading style. Asked by stays.
- **title-norsk**: Bonus til Kari Nordmann, or similar.
- **button-name**: e.g. Send to Ola Hansen. The button stays blue, same shape.
- **role-order**: Director · approves first, or similar. Rows keep their grey background.
- **status-approved**: May change the colour to green, as the app's own approved state; the pill stays a pill.
- **converted-under**: Keep the NOK field as it is, and add a small grey line under it, about €3 450.
- **third-approver**: A third row in the same grey style.
- **urgent-badge**: A small badge by the title; heading and asker line unchanged.
- **status-steps**: Two small steps, Ola then Ingrid; it stays small, where the pill was.
- **button-disabled**: Greyed or disabled, maybe with a short reason. Same size.
- **what-status**: A question: point and say it. No mock-up, no code change.
- **who-ingrid**: No mock-up.
- **why-blue**: No mock-up.
