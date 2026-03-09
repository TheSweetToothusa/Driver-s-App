
export type Priority = 'Standard' | 'Urgent' | 'Sympathy';
export type AppRole = 'ADMIN' | 'DRIVER';

export enum DeliveryStatus {
  PENDING = 'PENDING',
  ASSIGNED = 'ASSIGNED',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  ATTEMPTED = 'ATTEMPTED',
  CLOSED = 'CLOSED'
}

export type FailureReason = 
  | 'NOT_HOME' 
  | 'BAD_ADDRESS' 
  | 'UNSAFE' 
  | 'REFUSED' 
  | 'CONCIERGE_REJECTED' 
  | 'GATE_CODE_MISSING'
  | 'RECIPIENT_UNAVAILABLE'
  | 'LEFT_WITH_NEIGHBOR'
  | 'OTHER';

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
  isRead: boolean;
}

export interface Attempt {
  id: string;
  timestamp: string;
  driverId: string;
  driverName: string;
  type: 'FIRST' | 'SECOND';
  reason?: FailureReason;
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
  isPodMandatory?: boolean;
  
  confirmationPhoto?: string;
  confirmationSignature?: string;
  completedAt?: string;
  
  // New Enhanced Fields
  safeDropAllowed?: boolean;
  returnToStoreRequired?: boolean;
  neighborName?: string;
  mileageEstimate?: number;
  timeSpentMinutes?: number;
  
  attempts: Attempt[];
  internalNotes: string[];
  giftMessage?: string;
  giftSenderName?: string;
  giftSenderPhone?: string;
  giftSenderEmail?: string;
  giftReceiverName?: string;
  giftReceiverPhone?: string;
}

export interface ManualStop {
  id: string;
  type: 'GAS' | 'FOOD' | 'CHARGING' | 'BREAK';
  name: string;
  address?: string;
  timestamp: string;
}

export type RouteStop = (Delivery & { stopType: 'DELIVERY' }) | (ManualStop & { stopType: 'MANUAL' });

export interface Driver {
  id: string;
  name: string;
  vehicle: string;
  phone?: string;
  email?: string;
  accessCode?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  activeOrders?: number;
  totalCompleted?: number;
  successRate?: number;
}
