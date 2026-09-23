# RCA email workflow setup

The RCA page's **Email RCA Report** action invokes the live workflow UUID stored in the `rca-email-config` app setting.

Create a live Dynatrace Workflow with one **Send email** task and workflow inputs named:

- `to` — list of email addresses
- `cc` — list of email addresses
- `subject` — string
- `message` — string

Configure the Send email task with:

- **To:** `{{ execution().input.to }}`
- **Cc:** `{{ execution().input.cc }}`
- **Subject:** `{{ execution().input.subject }}`
- **Message:** `{{ execution().input.message }}`

The workflow must be live/deployed so the Automation API can run it. The workflow actor also needs permission for the Send email action, including `email:emails:send`.

After the workflow is created, copy its UUID into the app's **RCA email workflow configuration** setting for the `rca-email-config` schema.

The app sends the RCA body plus the Dynatrace Assist analysis to the workflow. The Email RCA action is independent from the existing PDF download action.
