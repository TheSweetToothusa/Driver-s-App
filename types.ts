
export type AppRole = 'SUPER_ADMIN' | 'MANAGER' | 'DRIVER';
export type Priority = 'Standard' | 'Urgent' | 'Sympathy';

export enum DeliveryStatus {
  PENDING = 'PENDING',
  SCHEDULED = 'SCHEDULED',          // confirmed, date set, not yet assigned to driver
  ASSIGNED = 'ASSIGNED',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',                // 1st attempt failed — auto-reschedule creates 2nd
  SECOND_ATTEMPT = 'SECOND_ATTEMPT', // rescheduled after 1st failure
  PENDING_RESCHEDULE = 'PENDING_RESCHEDULE', // waiting on Katie to reschedule manually
  CLOSED = 'CLOSED'
}

// The 5 standard failure reasons
export type FailureReason =
  | 'NO_ANSWER'          // No Answer / Recipient Unavailable
  | 'BAD_ADDRESS'        // Inaccurate or Incomplete Address
  | 'ACCESS_ISSUE'       // Gate / Lobby access problem
  | 'NO_SECURE_LOCATION' // No safe place to leave
  | 'REFUSED';           // Delivery refused at door

export const FAILURE_REASON_LABELS: Record<FailureReason, string> = {
  NO_ANSWER: 'No Answer / Recipient Unavailable',
  BAD_ADDRESS: 'Inaccurate or Incomplete Address',
  ACCESS_ISSUE: 'Access Issues (Gate/Lobby)',
  NO_SECURE_LOCATION: 'No Secure Location to Leave',
  REFUSED: 'Delivery Refused'
};

export interface UserAccount {
  id: string;
  name: string;
  pin: string;
  role: AppRole;
  phone?: string;
  email?: string;
  vehicle?: string;
  isActive: boolean;
  lockedUntil?: string;
  failedAttempts?: number;
  createdAt: string;
}

export interface Attempt {
  id: string;
  timestamp: string;
  driverId: string;
  driverName: string;
  attemptNumber: 1 | 2;
  reason: FailureReason;
  notes: string;
  photo?: string;
  signature?: string;
}

export interface DeliveryItem {
  id: string;
  name: string;
  quantity: number;
  sku: string;
  price: number;
  specialInstructions?: string;
}

export interface Delivery {
  id: string;
  orderNumber: string;
  customer: {
    name: string;
    phone: string;
    email: string;
  };
  address: {
    street: string;
    unit?: string;
    company?: string;
    city: string;
    zip: string;
    lat: number;
    lng: number;
  };
  items: DeliveryItem[];
  deliveryInstructions: string;
  status: DeliveryStatus;
  deliveryDate: string;
  deliveryWindow?: string;
  priority: Priority;
  deliveryFee: number;
  driverId: string;
  driverName?: string;

  isConfirmed?: boolean;
  driverNotes?: string;
  adminNotes?: string;

  confirmationPhoto?: string;
  confirmationSignature?: string;
  completedAt?: string;
  submittedAt?: string;

  safeDropAllowed?: boolean;
  neighborName?: string;

  attempts: Attempt[];
  internalNotes: string[];
  giftMessage?: string;
  giftSenderName?: string;
  giftSenderPhone?: string;
  giftSenderEmail?: string;
  giftReceiverName?: string;
  giftReceiverPhone?: string;

  // Which attempt number this delivery is (1 = first, 2 = rescheduled)
  attemptNumber?: 1 | 2;
  // If this is a 2nd attempt, link back to original
  originalDeliveryId?: string;

  successNotificationSent?: boolean;
  failureNotificationSent?: boolean;
  orderTotal?: number;
  createdAt?: string;
}

export interface MessageTemplate {
  id: 'SUCCESS' | 'FAILURE';
  label: string;
  body: string;
}

export interface Driver {
  id: string;
  name: string;
  vehicle: string;
  phone?: string;
  email?: string;
  status?: 'ACTIVE' | 'INACTIVE';
}

export interface ManualStop {
  id: string;
  type: 'GAS' | 'FOOD' | 'CHARGING' | 'BREAK';
  name: string;
  address?: string;
  timestamp: string;
}

export type ViewMode = 'DAY' | 'WEEK' | 'MONTH' | 'CUSTOM';
