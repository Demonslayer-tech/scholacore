export type UserRole = 'student' | 'teacher' | 'admin';
export type PaymentStatus = 'unpaid' | 'active_paid';
export type TeacherStatus = 'pending_vetting' | 'approved' | 'rejected';

export interface UserDoc {
  fullName: string;
  email: string;
  role: UserRole;
  gradeLevel: string | null;
  paymentStatus: PaymentStatus;
  telegramUserId: string | null;
  aiQueryCount: number;
  createdAt: unknown;
}

export interface TeacherDoc {
  fullName: string;
  email: string;
  credentialsSummary: string;
  subjectSpecializations: string[];
  verificationDocUrls: string[];
  status: TeacherStatus;
  reviewedBy: string | null;
  reviewedAt: unknown;
}

export interface ScheduleDoc {
  subjectName: string;
  teacherId: string;
  startTime: { toDate: () => Date };
  endTime: { toDate: () => Date };
  liveKitRoomName: string;
  recordingUrl: string | null;
  status: 'scheduled' | 'live' | 'ended';
}
