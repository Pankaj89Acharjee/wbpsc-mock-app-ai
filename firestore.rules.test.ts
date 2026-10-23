/**
 * WBPSC AI Mock Test & Tutor — Firestore Security Rules TDD Suite
 * Verifies all 12 "Dirty Dozen" adversarial payloads return PERMISSION_DENIED.
 */

export interface DirtyDozenTestCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: "get" | "list" | "create" | "update" | "delete";
  auth: {
    uid: string;
    email: string;
    email_verified: boolean;
  } | null;
  payload?: Record<string, unknown>;
  expectedOutcome: "PERMISSION_DENIED";
}

export const DIRTY_DOZEN_TEST_CASES: DirtyDozenTestCase[] = [
  {
    id: 1,
    name: "Self-Assigned Admin Escalation on Signup",
    collectionPath: "/users/user_1",
    operation: "create",
    auth: { uid: "user_1", email: "aspirant@example.com", email_verified: true },
    payload: {
      uid: "user_1",
      email: "aspirant@example.com",
      displayName: "Evil Aspirant",
      role: "admin",
      subscriptionTier: "free",
      preferredLanguage: "bn",
      targetExamSlug: "wbcs-prelims",
      dailyAiQueriesUsed: 0,
      isActive: true,
    },
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 2,
    name: "Self-Assigned Pro Tier Escalation on Update",
    collectionPath: "/users/user_1",
    operation: "update",
    auth: { uid: "user_1", email: "aspirant@example.com", email_verified: true },
    payload: {
      subscriptionTier: "wbcs_executive_pass",
    },
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 3,
    name: "Shadow Field Injection on User Profile",
    collectionPath: "/users/user_1",
    operation: "update",
    auth: { uid: "user_1", email: "aspirant@example.com", email_verified: true },
    payload: {
      displayName: "Valid Name",
      isSuperAdmin: true,
    },
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 4,
    name: "PII Leak via Cross-User Get",
    collectionPath: "/users/user_1",
    operation: "get",
    auth: { uid: "user_2", email: "other@example.com", email_verified: true },
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 5,
    name: "Unverified Admin Email Spoof",
    collectionPath: "/exams/wbcs-prelims",
    operation: "create",
    auth: {
      uid: "spoof_admin",
      email: "pankaj2007acharjee@gmail.com",
      email_verified: false,
    },
    payload: { id: "wbcs-prelims" },
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 6,
    name: "Orphaned Question Creation without Parent Exam",
    collectionPath: "/questions/q_orphan",
    operation: "create",
    auth: {
      uid: "admin_1",
      email: "pankaj2007acharjee@gmail.com",
      email_verified: true,
    },
    payload: {
      id: "q_orphan",
      examId: "non_existent_exam_id",
    },
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 7,
    name: "Aspirant Modifying Question Bank",
    collectionPath: "/questions/q_1",
    operation: "update",
    auth: { uid: "user_1", email: "aspirant@example.com", email_verified: true },
    payload: { correctOption: "A" },
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 8,
    name: "Identity Spoofing on Test Attempt",
    collectionPath: "/attempts/att_spoof",
    operation: "create",
    auth: { uid: "user_1", email: "aspirant@example.com", email_verified: true },
    payload: {
      id: "att_spoof",
      userId: "user_2",
      examId: "wbcs-prelims",
    },
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 9,
    name: "Terminal State Tampering on Submitted Attempt",
    collectionPath: "/attempts/att_1",
    operation: "update",
    auth: { uid: "user_1", email: "aspirant@example.com", email_verified: true },
    payload: {
      finalNetScore: 200,
    },
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 10,
    name: "Forged Client Timestamp on Attempt",
    collectionPath: "/attempts/att_time_forge",
    operation: "create",
    auth: { uid: "user_1", email: "aspirant@example.com", email_verified: true },
    payload: {
      id: "att_time_forge",
      userId: "user_1",
      createdAt: "2020-01-01T00:00:00Z",
    },
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 11,
    name: "Denial-of-Wallet Oversized String",
    collectionPath: "/users/user_1",
    operation: "update",
    auth: { uid: "user_1", email: "aspirant@example.com", email_verified: true },
    payload: {
      displayName: "A".repeat(5000),
    },
    expectedOutcome: "PERMISSION_DENIED",
  },
  {
    id: 12,
    name: "Unauthorized Query Scraping on Attempts",
    collectionPath: "/attempts",
    operation: "list",
    auth: { uid: "user_2", email: "other@example.com", email_verified: true },
    expectedOutcome: "PERMISSION_DENIED",
  },
];
