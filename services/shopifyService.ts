import { Delivery, DeliveryStatus } from '../types';

// Shopify credentials are stored server-side in .env.local.
// The client calls /api/orders which proxies to Shopify via server.ts.

export const getDeliveries = async (): Promise<Delivery[]> => {
  try {
    const response = await fetch('/api/orders');
    if (!response.ok) throw new Error("Connection failed");
    
    const data = await response.json();
    const orders = data.orders || [];
    const podData = data.podData || {};
    
    // STRICT FILTER: Local Delivery tag only
    const localDeliveryOrders = orders.filter((order: any) => {
      const tags = order.tags ? order.tags.split(',').map((t: string) => t.trim()) : [];
      return tags.includes('Local Delivery');
    });
    
    const mapped = localDeliveryOrders.map((order: any) => {
      const delivery = mapShopifyOrder(order);
      // Merge with saved POD data if it exists
      if (podData[delivery.id]) {
        return { ...delivery, ...podData[delivery.id] };
      }
      return delivery;
    });

    return mapped;
  } catch (error) {
    console.warn("Using Samples Fallback", error);
    return getCleanSamples();
  }
};

const mapShopifyOrder = (order: any): Delivery => {
  const shipping = order.shipping_address || {};
  const buyer = order.customer || {};
  
  const attributes: Record<string, string> = {};
  (order.note_attributes || []).forEach((attr: any) => {
    attributes[attr.name.toLowerCase()] = attr.value;
  });

  const filteredItems = (order.line_items || [])
    .filter((item: any) => !item.name.toLowerCase().includes('tip'))
    .map((item: any) => ({
      id: item.id.toString(),
      name: item.name,
      quantity: item.quantity,
      sku: item.sku || 'ST-001',
      price: parseFloat(item.price || '0'),
    }));

  const deliveryLine = order.shipping_lines?.[0];
  const shippingPrice = parseFloat(deliveryLine?.price || '15.00');

  return {
    id: order.id.toString(),
    orderNumber: order.name,
    customer: {
      name: `${shipping.first_name || 'Recipient'} ${shipping.last_name || ''}`.trim(),
      phone: shipping.phone || '',
      email: shipping.email || ''
    },
    address: {
      street: shipping.address1 || 'No Address Provided',
      city: shipping.city || 'Miami',
      zip: shipping.zip || '33139',
      lat: 25.946, lng: -80.155
    },
    items: filteredItems,
    deliveryFee: shippingPrice,
    deliveryInstructions: order.note || attributes['delivery instructions'] || '',
    status: DeliveryStatus.PENDING,
    deliveryDate: attributes['delivery date'] || 'Today', 
    priority: order.tags?.toLowerCase().includes('urgent') ? 'Urgent' : 
              order.tags?.toLowerCase().includes('sympathy') ? 'Sympathy' : 'Standard',
    driverId: 'smith',
    driverName: 'Smith',
    attempts: [],
    internalNotes: [],
    giftMessage: attributes['gift message'] || '',
    giftSenderName: `${buyer.first_name || 'Buyer'} ${buyer.last_name || ''}`.trim(),
    giftSenderPhone: buyer.phone || '',
    giftSenderEmail: buyer.email || ''
  };
};

const getCleanSamples = (): Delivery[] => {
  const todayStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return [
    {
      id: '33989',
      orderNumber: '#33989',
      customer: { name: 'Jon & Danielle Stief', phone: '305-555-0101', email: 'stief@example.com' },
      address: { street: '11120 S Sierra Rnch Dr', city: 'Davie', zip: '33330', lat: 26.06, lng: -80.24 },
      items: [{ id: 'i1', name: 'XL Sympathy Basket - Dairy', quantity: 1, sku: 'B-SYM-XL', price: 221.00 }],
      deliveryFee: 15.00,
      deliveryInstructions: 'Fragile. Gate code 0912.',
      status: DeliveryStatus.PENDING,
      deliveryDate: todayStr,
      priority: 'Sympathy',
      driverId: 'smith',
      driverName: 'Smith',
      attempts: [],
      internalNotes: [],
      giftMessage: 'With deep sympathy from the neighborhood.',
      giftSenderName: 'Neighborhood Association'
    },
    {
      id: '33991',
      orderNumber: '#33991',
      customer: { name: 'Marcus Rodriguez', phone: '305-555-9988', email: 'mrodriguez@example.com' },
      address: { street: '1420 Brickell Ave', city: 'Miami', zip: '33131', lat: 25.75, lng: -80.19 },
      items: [{ id: 'i9', name: 'The Indulgence Crate', quantity: 1, sku: 'B-IND-LG', price: 145.00 }],
      deliveryFee: 15.00,
      deliveryInstructions: 'Gate code #9988. Call on arrival.',
      status: DeliveryStatus.FAILED,
      deliveryDate: todayStr,
      priority: 'Standard',
      driverId: 'smith',
      driverName: 'Smith',
      attempts: [{ id: 'fail-1', timestamp: new Date().toISOString(), driverId: 'smith', driverName: 'Smith', type: 'FIRST', reason: 'GATE_CODE_MISSING', notes: 'Gate code provided was incorrect. Recipient did not answer phone.' }],
      internalNotes: ['Requires redelivery tomorrow'],
      driverNotes: 'Security guard refused entry as the code #9988 didn\'t work. Customer phone went to voicemail.',
      giftMessage: 'Congratulations on the new place!',
      giftSenderName: 'The Real Estate Group'
    },
    {
      id: '33986',
      orderNumber: '#33986',
      customer: { name: 'Emilia Seidner', phone: '305-555-0202', email: 'ms@example.com' },
      address: { street: '2235 NE 204th St', city: 'Miami', zip: '33180', lat: 25.96, lng: -80.14 },
      items: [{ id: 'i2', name: 'XL Round Hanukkah - Dairy', quantity: 1, sku: 'B-HAN-XL', price: 211.00 }],
      deliveryFee: 15.00,
      deliveryInstructions: 'Deliver to front porch.',
      status: DeliveryStatus.PENDING,
      deliveryDate: todayStr,
      priority: 'Standard',
      driverId: 'smith',
      driverName: 'Smith',
      attempts: [],
      internalNotes: [],
      giftMessage: 'Happy Hanukkah!',
      giftSenderName: 'The Seidners'
    },
    {
      id: '33985',
      orderNumber: '#33985',
      customer: { name: 'Sarah Miller', phone: '954-555-0303', email: 'sm@example.com' },
      address: { street: '456 Ocean Dr', city: 'Miami Beach', zip: '33139', lat: 25.76, lng: -80.13 },
      items: [{ id: 'i3', name: 'Holiday Cheer Sampler', quantity: 1, sku: 'SAM-HOL', price: 45.00 }],
      deliveryFee: 15.00,
      deliveryInstructions: 'Leave with valet.',
      status: DeliveryStatus.DELIVERED,
      deliveryDate: todayStr,
      priority: 'Standard',
      driverId: 'smith',
      driverName: 'Smith',
      attempts: [],
      internalNotes: [],
      giftMessage: 'See you for Christmas!',
      giftSenderName: 'Grandma',
      confirmationPhoto: 'https://images.unsplash.com/photo-1531259683007-016a7b628fc3?w=400&q=80',
      confirmationSignature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAACXBIWXMAAAsTAAALEwEAmpwYAAAByUlEQVR4nO3dy2rCUBSE4T8XUvAOfvAeXk0P4tX0IJ5ND8K99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAGvIMF7yD938G99CAXfAEYrE5Y3n8YyAAAAABJRU5ErkJggg==',
      driverNotes: 'Left at the reception desk with Maria as requested.',
      completedAt: '09:45 AM'
    }
  ];
};
