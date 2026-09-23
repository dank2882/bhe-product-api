# FBC Maintenance Work Order email

Version: maintenance_work_order_v1

From: maintenance@foundedonfaith.com

Subject: FBC Work Order {reference} — {title}

Hello {recipientName},

Please review the following maintenance work order.

Work order: {reference}
Requested work: {title}
Location: {building} / {area}
Priority: {priority}
Requested completion: {targetDate}

Work instructions:
{instructions}

Access / scheduling:
{accessNotes}

Please reply to confirm whether you can take this work and when you expect to complete it. If a quote, materials purchase, or additional work is needed, please check with us before proceeding.

When finished, reply with what was done, any remaining issues, and completion photos when helpful. Please keep the work order reference in your reply.

Thank you,
Shawna
Faith Baptist Church Maintenance
maintenance@foundedonfaith.com

---

Draft only. Populate from the current task and Shawna's instructions; never include internal task notes automatically or invent scope, costs, deadlines or commitments. Email may be addressed to any valid email address without recipient registration or consent. Exact outgoing draft approval remains required before sending.

Use draftMaintenanceMessage with template:work_order, taskId, recipient and a stable requestKey. Optional recipientName, instructions, accessNotes and selected mediaIds customize the draft. The backend uses the current task; no message sends until the exact draft is approved.
