import { Delivery, DeliveryStatus, Driver } from '../types';

export const MOCK_DRIVERS: Driver[] = [
  { id: 'driver_john', name: 'John Doe', vehicle: 'Sprinter Van #1' },
  { id: 'driver_sarah', name: 'Sarah Miller', vehicle: 'Tesla Model Y' },
  { id: 'driver_adam', name: 'Adam K.', vehicle: 'Refrigerated Truck' }
];

export const MOCK_DELIVERIES: Delivery[] = [
  {
    id: 'ord_33889',
    orderNumber: '#33889',
    customer: { name: 'Adam Kaplan', phone: '954-465-5645', email: 'adam@example.com' },
    giftReceiverName: 'The Hagen Family',
    giftSenderName: 'Adam and Caryn',
    giftMessage: 'Please accept our deepest condolences.',
    address: { street: '456 Sympathy Lane', city: 'Hollywood', zip: '33021', lat: 26.01, lng: -80.14 },
    items: [{ id: 'i1', name: 'Sympathy XL Basket', quantity: 1, sku: 'B-SYM-XL', price: 185, specialInstructions: 'Parve Requested' }],
    deliveryFee: 25.00,
    deliveryInstructions: 'Fragile. Gate code 1234.',
    status: DeliveryStatus.PENDING,
    deliveryDate: new Date().toISOString().split('T')[0],
    deliveryWindow: '12:00 PM - 4:00 PM',
    priority: 'Sympathy',
    driverId: 'driver_john',
    driverName: 'John Doe',
    attempts: [],
    internalNotes: ['Customer requested call before arrival']
  },
  {
    id: 'ord_33890',
    orderNumber: '#33890',
    customer: { name: 'Jessica Chen', phone: '305-555-0101', email: 'jess@me.com' },
    giftReceiverName: 'Grand Oaks Hospital',
    giftSenderName: 'Corporate Team',
    giftMessage: 'Happy Birthday!',
    address: { street: '1200 Hospital Blvd', city: 'Davie', zip: '33314', lat: 26.06, lng: -80.24 },
    items: [{ id: 'i2', name: 'Chocolate Tower', quantity: 2, sku: 'TOWER-S', price: 95 }],
    deliveryFee: 15.00,
    deliveryInstructions: 'Deliver to main lobby front desk.',
    status: DeliveryStatus.IN_TRANSIT,
    deliveryDate: new Date().toISOString().split('T')[0],
    deliveryWindow: '9:00 AM - 12:00 PM',
    priority: 'Urgent',
    driverId: 'driver_sarah',
    driverName: 'Sarah Miller',
    attempts: [{
      id: 'a1', timestamp: '2025-05-10T09:30:00Z',
      driverId: 'driver_sarah', driverName: 'Sarah Miller',
      attemptNumber: 1, reason: 'NO_ANSWER', notes: 'No one answered the door.'
    }],
    internalNotes: []
  }
];
