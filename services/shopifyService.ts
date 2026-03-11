import { Delivery, DeliveryStatus } from '../types';
import { DELIVERY_FEES } from '../src/constants';

export const getDeliveries = async (): Promise<Delivery[]> => {
  try {
    const response = await fetch('/api/orders');
    if (!response.ok) throw new Error("Connection failed");
    const data = await response.json();
    const orders = data.orders || [];
    const podData = data.podData || {};

    // If Shopify returns real orders, use them
    if (orders.length > 0) {
      const mapped = orders.map((order: any) => {
        const delivery = mapShopifyOrder(order);
        if (podData[delivery.id]) {
          return { ...delivery, ...podData[delivery.id] };
        }
        return delivery;
      });
      return mapped;
    }

    // Otherwise fall back to samples (for testing)
    return getSamples();
  } catch (error) {
    console.warn("Shopify unavailable, using samples", error);
    return getSamples();
  }
};

// Parse a delivery date string from Shopify note attributes into YYYY-MM-DD
// Handles: "Mar 9", "March 9", "03/09/2026", "2026-03-09", "Today", etc.
function parseDeliveryDate(raw: string | undefined): string {
  const today = new Date().toISOString().split('T')[0];
  if (!raw) return today;
  const s = raw.trim().toLowerCase();
  if (s === 'today' || s === '') return today;

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // MM/DD/YYYY
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;

  // "Mar 9" or "March 9" or "Mar 9, 2026"
  const monthNames: Record<string,string> = {
    jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
    jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'
  };
  const mn = raw.match(/^([a-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?$/i);
  if (mn) {
    const mon = monthNames[mn[1].toLowerCase().slice(0,3)];
    if (mon) {
      const year = mn[3] || new Date().getFullYear().toString();
      return `${year}-${mon}-${mn[2].padStart(2,'0')}`;
    }
  }

  // Try native Date parse as last resort
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];

  return today;
}

const mapShopifyOrder = (order: any): Delivery => {
  const shipping = order.shipping_address || {};
  const buyer = order.customer || {};

  const attributes: Record<string, string> = {};
  (order.note_attributes || []).forEach((attr: any) => {
    attributes[attr.name.toLowerCase().trim()] = attr.value;
  });

  const filteredItems = (order.line_items || [])
    .filter((item: any) => !item.name.toLowerCase().includes('tip'))
    .map((item: any) => ({
      id: item.id.toString(),
      name: item.name,
      quantity: item.quantity,
      sku: item.sku || '',
      price: parseFloat(item.price || '0'),
    }));

  // Look up fee from ZIP-based rate table; fall back to Shopify shipping price
  const zipCode = (order.shipping_address?.zip || '').toString().trim().slice(0, 5);
  const shippingPrice = DELIVERY_FEES[zipCode] ?? parseFloat(order.shipping_lines?.[0]?.price || '0');

  // Try multiple attribute keys for delivery date
  const rawDate = attributes['delivery date'] 
    || attributes['deliverydate'] 
    || attributes['delivery_date']
    || attributes['date']
    || attributes['Delivery Date']
    || attributes['Delivery date']
    || '';
  // If no delivery date found, log it so we can debug
  if (!rawDate) console.log('No delivery date for order', order.id, 'attributes:', Object.keys(attributes));

  return {
    id: order.id.toString(),
    orderNumber: order.name,
    customer: {
      name: `${shipping.first_name || ''} ${shipping.last_name || ''}`.trim() || 'Recipient',
      phone: shipping.phone || buyer.phone || '',
      email: buyer.email || ''
    },
    address: {
      street: [shipping.address1, shipping.address2].filter(Boolean).join(' ') || 'No Address',
      city: shipping.city || 'Miami',
      zip: shipping.zip || '33179',
      lat: 25.946, lng: -80.155
    },
    items: filteredItems,
    deliveryFee: shippingPrice,
    orderTotal: parseFloat(order.total_price || order.subtotal_price || "0"),
    deliveryInstructions: order.note || attributes['delivery instructions'] || attributes['instructions'] || '',
    status: (order._st_status as DeliveryStatus) || DeliveryStatus.PENDING,
    completedAt: order._st_completedAt || undefined,
    deliveryDate: parseDeliveryDate(rawDate),
    priority: order.tags?.toLowerCase().includes('urgent') ? 'Urgent' :
              order.tags?.toLowerCase().includes('sympathy') ? 'Sympathy' : 'Standard',
    driverId: '',
    driverName: '',
    attempts: [],
    internalNotes: [],
    giftMessage: attributes['gift message'] || attributes['giftmessage'] || attributes['message'] || order.note || '',
    giftSenderName: `${buyer.first_name || ''} ${buyer.last_name || ''}`.trim() || 'Customer',
    giftSenderPhone: buyer.phone || '',
    giftSenderEmail: buyer.email || '',
    giftReceiverName: `${shipping.first_name || ''} ${shipping.last_name || ''}`.trim() || ''
  };
};

// Sample data for testing — uses today's date in YYYY-MM-DD so schedule filter works
const getSamples = (): Delivery[] => {
  const today = new Date().toISOString().split('T')[0];
  return [
    {
      id: '33989',
      orderNumber: '#33989',
      customer: { name: 'Jon & Danielle Stief', phone: '305-555-0101', email: 'stief@example.com' },
      address: { street: '11120 S Sierra Ranch Dr', city: 'Davie', zip: '33330', lat: 26.06, lng: -80.24 },
      items: [{ id: 'i1', name: 'XL Sympathy Basket - Dairy', quantity: 1, sku: 'B-SYM-XL', price: 221.00 }],
      deliveryFee: 30.00,
      deliveryInstructions: 'Fragile. Gate code 0912.',
      status: DeliveryStatus.PENDING,
      deliveryDate: today,
      priority: 'Sympathy',
      driverId: '',
      driverName: '',
      attempts: [],
      internalNotes: [],
      giftMessage: 'With deep sympathy from the neighborhood.',
      giftSenderName: 'The Neighborhood Association',
      giftReceiverName: 'The Stief Family'
    },
    {
      id: '33991',
      orderNumber: '#33991',
      customer: { name: 'Marcus Rodriguez', phone: '305-555-9988', email: 'mrodriguez@example.com' },
      address: { street: '1420 Brickell Ave', city: 'Miami', zip: '33131', lat: 25.75, lng: -80.19 },
      items: [{ id: 'i9', name: 'The Indulgence Crate', quantity: 1, sku: 'B-IND-LG', price: 145.00 }],
      deliveryFee: 25.00,
      deliveryInstructions: 'Gate code #9988. Call on arrival.',
      status: DeliveryStatus.FAILED,
      deliveryDate: today,
      priority: 'Standard',
      driverId: '',
      driverName: '',
      attempts: [{ id: 'fail-1', timestamp: new Date().toISOString(), driverId: '', driverName: '', attemptNumber: 1 as 1|2, reason: 'ACCESS_ISSUE', notes: 'Gate code provided was incorrect.' }],
      internalNotes: [],
      giftMessage: 'Congratulations on the new place!',
      giftSenderName: 'The Real Estate Group',
      giftReceiverName: 'Marcus Rodriguez'
    },
    {
      id: '33985',
      orderNumber: '#33985',
      customer: { name: 'Sarah Miller', phone: '954-555-0303', email: 'sm@example.com' },
      address: { street: '456 Ocean Dr', city: 'Miami Beach', zip: '33139', lat: 25.76, lng: -80.13 },
      items: [{ id: 'i3', name: 'Holiday Cheer Sampler', quantity: 1, sku: 'SAM-HOL', price: 45.00 }],
      deliveryFee: 25.00,
      deliveryInstructions: 'Leave with valet.',
      status: DeliveryStatus.DELIVERED,
      deliveryDate: today,
      priority: 'Standard',
      driverId: '',
      driverName: '',
      attempts: [],
      internalNotes: [],
      giftMessage: 'See you soon!',
      giftSenderName: 'Grandma',
      giftReceiverName: 'Sarah Miller',
      completedAt: new Date().toISOString()
    }
  ];
};
