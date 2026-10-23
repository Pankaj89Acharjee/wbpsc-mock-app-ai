# Phase 0: Payload-First Security TDD (`security_spec.md`)

## 1. Data Invariants
1. **Zero-Trust RBAC (`users` & `admins`)**:
   - A standard user (`request.auth.uid == userId`) can create their `/users/{userId}` document ONLY with `role == 'aspirant'` and `subscriptionTier == 'free'`, unless they are the verified bootstrap admin (`pankaj2007acharjee@gmail.com` with `email_verified == true`).
   - Users can never self-promote their `role` or `subscriptionTier` on update. Only `isAdmin()` can modify `role`, `subscriptionTier`, or `isActive`.
   - `/users/{userId}` contains PII (`email`), so `get` is strictly restricted to `isOwner(userId) || isAdmin()`, and `list` is restricted to `isAdmin()`.
2. **Master Gate & Global Consistency (`questions`, `attempts`, `mastery`)**:
   - A `BilingualQuestion`, `TestAttemptRecord`, or `SubtopicMasteryRecord` cannot be created unless the referenced `/exams/{examId}` document exists (`exists(/databases/$(database)/documents/exams/$(incoming().examId))`).
3. **Terminal State Locking (`attempts`)**:
   - `TestAttemptRecord` documents are created in terminal state `status == 'submitted'` and cannot be modified by aspirants after submission (`isAdmin()` override only).
4. **Temporal & Identity Integrity**:
   - Every `createdAt` and `updatedAt` field must equal `request.time`.
   - Every document ID path variable is guarded by `isValidId()` (`^[a-zA-Z0-9_\-]+$`, max 128 chars).

---

## 2. The "Dirty Dozen" Payloads

1. **Payload 1 (Self-Assigned Admin Escalation on Signup)**: User creates `/users/user_1` with `role: "admin"`. -> `PERMISSION_DENIED`
2. **Payload 2 (Self-Assigned Pro Tier Escalation on Update)**: User updates `/users/user_1` changing `subscriptionTier: "wbcs_executive_pass"`. -> `PERMISSION_DENIED`
3. **Payload 3 (Shadow Field Injection on User Profile)**: User updates `/users/user_1` adding `isSuperAdmin: true`. -> `PERMISSION_DENIED`
4. **Payload 4 (PII Leak via Cross-User Get)**: User `user_2` reads `/users/user_1`. -> `PERMISSION_DENIED`
5. **Payload 5 (Unverified Admin Email Spoof)**: Attacker with `email: "pankaj2007acharjee@gmail.com"` but `email_verified: false` attempts to write to `/exams/wbcs-prelims`. -> `PERMISSION_DENIED`
6. **Payload 6 (Orphaned Question Creation)**: Admin creates `/questions/q_99` referencing non-existent `examId: "non-existent-exam"`. -> `PERMISSION_DENIED`
7. **Payload 7 (Aspirant Modifying Question Bank)**: Aspirant `user_1` attempts to create or update `/questions/q_1`. -> `PERMISSION_DENIED`
8. **Payload 8 (Identity Spoofing on Test Attempt)**: Aspirant `user_1` creates `/attempts/att_1` with `userId: "user_2"`. -> `PERMISSION_DENIED`
9. **Payload 9 (Terminal State Tampering on Submitted Attempt)**: Aspirant `user_1` attempts to update `finalNetScore` on already submitted `/attempts/att_1`. -> `PERMISSION_DENIED`
10. **Payload 10 (Forged Client Timestamp)**: Aspirant creates `/attempts/att_2` with a past/future `createdAt` != `request.time`. -> `PERMISSION_DENIED`
11. **Payload 11 (Denial-of-Wallet Oversized String)**: Aspirant updates `displayName` with a 5,000-character string (`> 120` max). -> `PERMISSION_DENIED`
12. **Payload 12 (Unauthorized Query Scraping on Attempts)**: Aspirant `user_1` executes an unconstrained `list` query on `/attempts` without filtering `userId == request.auth.uid`. -> `PERMISSION_DENIED`
