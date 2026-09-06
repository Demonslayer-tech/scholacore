# ScholaCore — Firestore Schema

## `users/{uid}`
| Field | Type | Notes |
|---|---|---|
| fullName | string | |
| email | string | |
| role | 'student' \| 'teacher' \| 'admin' | set at creation, server-managed afterward |
| gradeLevel | string \| null | students only |
| paymentStatus | 'unpaid' \| 'active_paid' | flipped only by Paystack webhook / admin |
| telegramUserId | string \| null | linked when opened from the Telegram Mini App |
| aiQueryCount | number | mirrors `ai_usage/{uid}_{yyyy-mm-dd}` |
| createdAt | timestamp | |

## `teachers/{uid}`
| Field | Type | Notes |
|---|---|---|
| fullName | string | |
| email | string | |
| credentialsSummary | string | |
| subjectSpecializations | string[] | |
| verificationDocUrls | string[] | Storage paths under `teacher-verifications/{uid}/` |
| status | 'pending_vetting' \| 'approved' \| 'rejected' | admin-controlled |
| reviewedBy | string \| null | admin uid |
| reviewedAt | timestamp \| null | |

## `schedules/{scheduleId}`
| Field | Type | Notes |
|---|---|---|
| subjectName | string | |
| teacherId | string | must match an approved teacher |
| startTime | timestamp | |
| endTime | timestamp | |
| liveKitRoomName | string | |
| recordingUrl | string \| null | filled in after Egress finishes |
| status | 'scheduled' \| 'live' \| 'ended' | |

## `transactions/{transactionId}`
| Field | Type | Notes |
|---|---|---|
| paystackReference | string | unique |
| studentId | string | |
| amount | number | kobo |
| status | 'pending' \| 'success' \| 'failed' | |
| retryCount | number | |
| lastError | string \| null | |
| createdAt | timestamp | |

## `ai_usage/{uid}_{yyyy-mm-dd}`
| Field | Type | Notes |
|---|---|---|
| studentId | string | |
| date | string | `yyyy-mm-dd` |
| count | number | capped at 30/day, incremented in a Firestore transaction |

## `webhook_events/{eventId}`
| Field | Type | Notes |
|---|---|---|
| source | 'paystack' | |
| payload | map | raw event body |
| processed | boolean | |
| attempts | number | |
| lastAttemptAt | timestamp | |
| error | string \| null | |
