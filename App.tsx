import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Package, Truck, ChevronRight, X, Check, RefreshCw,
  LogOut, Calendar, MapPin, Phone, MessageSquare,
  Navigation, CheckCircle2, Send, ShieldCheck,
  AlertTriangle, Eye, Camera, PenTool, Mail, Trash2,
  Copy, Settings, Lock, Key, EyeOff, AlertCircle, FileText,
  Share2, Zap, Filter, ArrowRightLeft, UserPlus, Users,
  MessageCircle, ChevronLeft, Edit3, ToggleLeft, ToggleRight,
  Bell, Clock, CheckSquare, XCircle, Gift, User
} from 'lucide-react';
import { Delivery, DeliveryStatus, AppRole, FailureReason, ViewMode, UserAccount, MessageTemplate } from './types';
import { getDeliveries } from './services/shopifyService';
import { DELIVERY_FEES } from './src/constants';
import { getOptimizedRoute, generateCustomerSMS, OptimizationResult } from './services/geminiService';

const BRAND_LOGO = "https://cdn.shopify.com/s/files/1/0559/8498/0141/files/The_Sweet_Tooth_Chocolate_Factory_Logo.png?v=1759286605";
const KATIE_PHONE = "(305) 994-4070";

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────

const base64ToBlob = (base64: string, mimeType: string) => {
  const byteString = atob(base64.split(',')[1]);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
  return new Blob([ab], { type: mimeType });
};

const isWithinSendingHours = () => {
  const h = new Date().getHours();
  return h >= 9 && h < 20;
};

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// ─────────────────────────────────────────────────────────────────────────────
// SIGNATURE PAD
// ─────────────────────────────────────────────────────────────────────────────

const SignaturePad: React.FC<{ onSave: (dataUrl: string) => void; onCancel: () => void }> = ({ onSave, onCancel }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    const getPos = (e: MouseEvent | TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const start = (e: MouseEvent | TouchEvent) => {
      isDrawing.current = true;
      const { x, y } = getPos(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
    };
    const move = (e: MouseEvent | TouchEvent) => {
      if (!isDrawing.current) return;
      e.preventDefault();
      const { x, y } = getPos(e);
      ctx.lineTo(x, y);
      ctx.stroke();
    };
    const stop = () => { isDrawing.current = false; };

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', stop);
    return () => {
      canvas.removeEventListener('mousedown', start);
      canvas.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
      canvas.removeEventListener('touchstart', start);
      canvas.removeEventListener('touchmove', move);
      canvas.removeEventListener('touchend', stop);
    };
  }, []);

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <div className="fixed inset-0 bg-black/90 z-[300] flex flex-col p-6 animate-in fade-in">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-white font-black uppercase tracking-widest text-xs">Recipient Signature</h3>
        <button onClick={onCancel} className="text-white/50"><X size={24} /></button>
      </div>
      <p className="text-white/40 text-xs mb-4 font-medium">Optional — ask recipient to sign if available</p>
      <div className="flex-1 bg-white rounded-3xl overflow-hidden relative border-4 border-white">
        <canvas ref={canvasRef} width={400} height={600} className="w-full h-full touch-none" />
        <div className="absolute bottom-4 left-0 right-0 text-center pointer-events-none">
          <p className="text-[10px] font-black uppercase text-stone-300 tracking-widest">Sign inside the box</p>
        </div>
      </div>
      <div className="mt-4 flex gap-3">
        <button onClick={handleClear} className="flex-1 py-5 bg-white/10 text-white rounded-2xl font-black uppercase text-[10px]">Clear</button>
        <button onClick={onCancel} className="flex-1 py-5 bg-white/20 text-white rounded-2xl font-black uppercase text-[10px]">Skip</button>
        <button
          onClick={() => canvasRef.current && onSave(canvasRef.current.toDataURL())}
          className="flex-2 py-5 bg-white text-black rounded-2xl font-black uppercase text-[10px] px-6"
        >Confirm</button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN GATE — 3 roles, per-user PIN, lockout
// ─────────────────────────────────────────────────────────────────────────────

const LoginGate: React.FC<{ onAuthorized: (user: UserAccount) => void }> = ({ onAuthorized }) => {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [step, setStep] = useState<'NAME' | 'PIN'>('NAME');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleNameSubmit = () => {
    if (!name.trim()) { setError('Please enter your name'); return; }
    setError('');
    setStep('PIN');
  };

  const handlePinSubmit = async () => {
    if (pin.length !== 4) { setError('Enter your 4-digit PIN'); return; }
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), pin })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Invalid PIN');
        setPin('');
      } else {
        onAuthorized(data.user);
      }
    } catch {
      setError('Connection error. Try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-10 animate-in fade-in duration-500">
      <img src={BRAND_LOGO} className="h-40 mb-10 object-contain" alt="Logo" />

      {step === 'NAME' ? (
        <div className="w-full max-w-xs space-y-4">
          <h2 className="text-xl font-black text-black tracking-tight uppercase text-center mb-6">Who are you?</h2>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleNameSubmit()}
            placeholder="Enter your name"
            className="w-full bg-stone-50 border-2 border-stone-100 rounded-[24px] px-6 py-5 text-center text-lg font-black outline-none focus:border-black transition-all"
          />
          {error && <p className="text-[11px] font-black text-red-500 uppercase text-center">{error}</p>}
          <button
            onClick={handleNameSubmit}
            className="w-full py-5 bg-black text-white rounded-[24px] font-black uppercase tracking-widest shadow-lg active:scale-95 transition-all"
          >Continue</button>
        </div>
      ) : (
        <div className="w-full max-w-xs space-y-4">
          <button onClick={() => { setStep('NAME'); setPin(''); setError(''); }} className="flex items-center gap-1 text-stone-400 text-xs font-black uppercase mb-4">
            <ChevronLeft size={14} /> Back
          </button>
          <h2 className="text-xl font-black text-black tracking-tight uppercase text-center mb-2">Hi, {name}!</h2>
          <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest text-center mb-6">Enter your 4-digit PIN</p>
          <div className="relative">
            <input
              autoFocus
              type={showPin ? 'text' : 'password'}
              inputMode="numeric"
              pattern="[0-9]*"
              value={pin}
              onChange={(e) => setPin(e.target.value.slice(0, 4))}
              onKeyDown={(e) => e.key === 'Enter' && handlePinSubmit()}
              placeholder="0000"
              maxLength={4}
              className={`w-full bg-stone-50 border-2 rounded-[24px] px-6 py-5 text-center text-4xl font-black tracking-[0.5em] outline-none transition-all ${error ? 'border-red-500' : 'border-stone-100 focus:border-black'}`}
            />
            <button type="button" onClick={() => setShowPin(!showPin)} className="absolute right-6 top-1/2 -translate-y-1/2 text-stone-300">
              {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {error && <p className="text-[11px] font-black text-red-500 uppercase text-center">{error}</p>}
          <button
            onClick={handlePinSubmit}
            disabled={isLoading}
            className="w-full py-5 bg-black text-white rounded-[24px] font-black uppercase tracking-widest shadow-lg active:scale-95 transition-all disabled:opacity-50"
          >{isLoading ? 'Checking...' : 'Unlock'}</button>
        </div>
      )}
      <p className="mt-12 text-[10px] font-black text-stone-300 uppercase tracking-widest">The Sweet Tooth • Internal Use Only</p>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ORDER CARD — full gift/product info
// ─────────────────────────────────────────────────────────────────────────────

const OrderCard: React.FC<{ order: Delivery; role: AppRole; onTap: () => void; isSelected: boolean }> = ({ order, role, onTap, isSelected }) => {
  const statusColor =
    order.status === DeliveryStatus.DELIVERED ? 'bg-green-500 text-white' :
    order.status === DeliveryStatus.FAILED ? 'bg-red-500 text-white' :
    order.status === DeliveryStatus.IN_TRANSIT ? 'bg-blue-500 text-white' :
    'bg-stone-200 text-stone-600';

  return (
    <div
      onClick={onTap}
      className={`p-5 border-b border-stone-50 cursor-pointer transition-all ${isSelected ? 'bg-pink-50 border-l-4 border-l-pink-400' : 'hover:bg-stone-50'}`}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <span className="text-[10px] font-black text-stone-400 uppercase">Order {order.orderNumber}</span>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-[8px] px-2 py-0.5 rounded-full font-black uppercase ${statusColor}`}>
              {order.status.replace('_', ' ')}
            </span>
            {order.priority === 'Urgent' && (
              <span className="text-[8px] px-2 py-0.5 rounded-full font-black uppercase bg-orange-100 text-orange-600">Urgent</span>
            )}
          </div>
        </div>
        <ChevronRight size={16} className="text-stone-300 mt-1" />
      </div>

      {/* Recipient */}
      <div className="flex items-center gap-2 mb-1">
        <User size={12} className="text-stone-400 shrink-0" />
        <p className="text-sm font-black text-stone-900">{order.giftReceiverName || order.customer.name}</p>
      </div>

      {/* From */}
      {order.giftSenderName && (
        <div className="flex items-center gap-2 mb-1">
          <Gift size={12} className="text-pink-400 shrink-0" />
          <p className="text-xs font-bold text-stone-500">From: {order.giftSenderName}</p>
        </div>
      )}

      {/* Products */}
      {order.items?.length > 0 && (
        <div className="flex items-start gap-2 mb-1">
          <Package size={12} className="text-stone-400 shrink-0 mt-0.5" />
          <p className="text-xs font-bold text-stone-600 leading-tight">
            {order.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
          </p>
        </div>
      )}

      {/* Gift message */}
      {order.giftMessage && (
        <div className="mt-2 p-2 bg-pink-50 rounded-xl border border-pink-100">
          <p className="text-[9px] font-black uppercase text-pink-400 mb-0.5">Gift Message</p>
          <p className="text-xs text-stone-600 italic">"{order.giftMessage}"</p>
        </div>
      )}

      {/* Address + fee (admin only) */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1.5">
          <MapPin size={11} className="text-stone-300" />
          <p className="text-[10px] font-bold text-stone-400">{order.address.city}, {order.address.zip}</p>
        </div>
        {(role === 'SUPER_ADMIN' || role === 'MANAGER') && (
          <span className="text-[10px] font-black text-stone-500">${order.deliveryFee}</span>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ORDER DETAIL — 3-tap flow + notification
// ─────────────────────────────────────────────────────────────────────────────

const OrderDetail: React.FC<{
  order: Delivery;
  role: AppRole;
  currentUser: UserAccount;
  allUsers: UserAccount[];
  onUpdate: (id: string, updates: Partial<Delivery>) => void;
  onBack: () => void;
}> = ({ order, role, currentUser, allUsers, onUpdate, onBack }) => {
  const [isSigning, setIsSigning] = useState(false);
  const [photoData, setPhotoData] = useState<string | null>(order.confirmationPhoto || null);
  const [sigData, setSigData] = useState<string | null>(order.confirmationSignature || null);
  const [failReason, setFailReason] = useState<FailureReason>('NOT_HOME');
  const [driverNote, setDriverNote] = useState(order.driverNotes || '');
  const [showFailMenu, setShowFailMenu] = useState(false);
  const [adminNote, setAdminNote] = useState('');
  const [showNotifyPreview, setShowNotifyPreview] = useState<null | 'SUCCESS' | 'FAILURE'>(null);
  const [notifyPreviewText, setNotifyPreviewText] = useState('');
  const [notifyChannel, setNotifyChannel] = useState('');
  const [notifySent, setNotifySent] = useState(false);
  const [isSendingNotify, setIsSendingNotify] = useState(false);
  const [reassignTo, setReassignTo] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAdmin = role === 'SUPER_ADMIN' || role === 'MANAGER';

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setPhotoData(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleComplete = async () => {
    const now = new Date().toISOString();
    onUpdate(order.id, {
      status: DeliveryStatus.DELIVERED,
      confirmationPhoto: photoData || undefined,
      confirmationSignature: sigData || undefined,
      driverNotes: driverNote,
      completedAt: now,
      submittedAt: now
    });
    await fetch('/api/pod', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: order.id, photo: photoData, signature: sigData,
        notes: driverNote, completedAt: now, status: 'DELIVERED',
        driverId: currentUser.id, driverName: currentUser.name
      })
    });
  };

  const handleFailed = async () => {
    const now = new Date().toISOString();
    onUpdate(order.id, {
      status: DeliveryStatus.FAILED,
      confirmationPhoto: photoData || undefined,
      confirmationSignature: sigData || undefined,
      driverNotes: driverNote,
      submittedAt: now,
      attempts: [
        ...(order.attempts || []),
        { id: Date.now().toString(), timestamp: now, driverId: currentUser.id, driverName: currentUser.name, type: 'FIRST', reason: failReason, notes: driverNote, photo: photoData || undefined, signature: sigData || undefined }
      ]
    });
    await fetch('/api/pod', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: order.id, photo: photoData, signature: sigData,
        notes: driverNote, submittedAt: now, status: 'FAILED',
        driverId: currentUser.id, driverName: currentUser.name, failReason
      })
    });
    setShowFailMenu(false);
  };

  const loadPreview = async (type: 'SUCCESS' | 'FAILURE') => {
    const res = await fetch('/api/notify/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, order })
    });
    const data = await res.json();
    setNotifyPreviewText(data.preview);
    setNotifyChannel(data.channel);
    setShowNotifyPreview(type);
    setNotifySent(false);
  };

  const handleSend = async () => {
    if (!showNotifyPreview) return;
    if (!isWithinSendingHours()) {
      alert('Messages can only be sent between 9 AM and 8 PM.');
      return;
    }
    setIsSendingNotify(true);
    const res = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: showNotifyPreview, order })
    });
    const data = await res.json();
    setIsSendingNotify(false);
    if (data.sent) {
      setNotifySent(true);
      onUpdate(order.id, showNotifyPreview === 'SUCCESS' ? { successNotificationSent: true } : { failureNotificationSent: true });
    } else {
      alert(data.error || 'Failed to send. Check Twilio/SendGrid setup.');
    }
  };

  const handleAddAdminNote = async () => {
    if (!adminNote.trim()) return;
    await fetch(`/api/orders/${order.id}/note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: adminNote })
    });
    onUpdate(order.id, { adminNotes: order.adminNotes ? `${order.adminNotes}\n[${new Date().toLocaleString()}] ${adminNote}` : `[${new Date().toLocaleString()}] ${adminNote}` });
    setAdminNote('');
  };

  const handleReassign = async () => {
    if (!reassignTo) return;
    const driver = allUsers.find(u => u.id === reassignTo);
    if (!driver) return;
    await fetch(`/api/orders/${order.id}/assign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId: driver.id, driverName: driver.name })
    });
    onUpdate(order.id, { driverId: driver.id, driverName: driver.name });
    setReassignTo('');
  };

  const isCompleted = order.status === DeliveryStatus.DELIVERED || order.status === DeliveryStatus.FAILED;

  return (
    <div className="flex flex-col min-h-screen bg-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-stone-100 px-4 py-4 flex items-center gap-3 shadow-sm">
        <button onClick={onBack} className="p-2 bg-stone-100 rounded-full"><ChevronLeft size={20} /></button>
        <div className="flex-1">
          <p className="text-[10px] font-black text-stone-400 uppercase">Order {order.orderNumber}</p>
          <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase mt-0.5 ${
            order.status === DeliveryStatus.DELIVERED ? 'bg-green-100 text-green-700' :
            order.status === DeliveryStatus.FAILED ? 'bg-red-100 text-red-700' :
            order.status === DeliveryStatus.IN_TRANSIT ? 'bg-blue-100 text-blue-700' :
            'bg-stone-100 text-stone-500'
          }`}>{order.status.replace('_', ' ')}</div>
        </div>
        {order.submittedAt && (
          <span className="text-[9px] font-black text-stone-400 uppercase">Submitted {formatTime(order.submittedAt)}</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5 pb-32">

        {/* Recipient & Gift */}
        <section className="p-5 bg-white border border-stone-100 rounded-[28px] shadow-sm space-y-3">
          <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest">Delivery Details</p>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-stone-100 rounded-full flex items-center justify-center shrink-0">
              <User size={18} className="text-stone-500" />
            </div>
            <div>
              <p className="font-black text-stone-900">{order.giftReceiverName || order.customer.name}</p>
              <p className="text-xs text-stone-400 font-medium">{order.customer.phone || order.customer.email}</p>
            </div>
          </div>
          {order.giftSenderName && (
            <div className="flex items-center gap-2 pt-1 border-t border-stone-50">
              <Gift size={14} className="text-pink-400" />
              <p className="text-xs font-bold text-stone-500">Gift from: <span className="text-stone-800">{order.giftSenderName}</span></p>
            </div>
          )}
        </section>

        {/* Products */}
        {order.items?.length > 0 && (
          <section className="p-5 bg-white border border-stone-100 rounded-[28px] shadow-sm space-y-2">
            <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest">Products</p>
            {order.items.map((item, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-stone-50 last:border-0">
                <div>
                  <p className="text-sm font-black text-stone-900">{item.name}</p>
                  {item.specialInstructions && <p className="text-xs text-stone-400 italic">{item.specialInstructions}</p>}
                </div>
                <span className="text-sm font-black text-stone-500">×{item.quantity}</span>
              </div>
            ))}
          </section>
        )}

        {/* Gift message */}
        {order.giftMessage && (
          <section className="p-5 bg-pink-50 border border-pink-100 rounded-[28px] space-y-2">
            <p className="text-[9px] font-black uppercase text-pink-400 tracking-widest">Gift Message</p>
            <p className="text-sm text-stone-700 italic leading-relaxed">"{order.giftMessage}"</p>
          </section>
        )}

        {/* Address */}
        <section className="p-5 bg-white border border-stone-100 rounded-[28px] shadow-sm space-y-3">
          <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest">Delivery Address</p>
          <p className="font-black text-stone-900">{order.address.street}</p>
          <p className="text-sm text-stone-500">{order.address.city}, FL {order.address.zip}</p>
          {order.deliveryInstructions && (
            <div className="mt-2 p-3 bg-amber-50 rounded-xl border border-amber-100">
              <p className="text-[9px] font-black uppercase text-amber-600 mb-1">Instructions</p>
              <p className="text-xs text-stone-700 leading-relaxed">{order.deliveryInstructions}</p>
            </div>
          )}
          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(order.address.street + ' ' + order.address.city + ' FL')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-4 bg-black text-white rounded-2xl font-black uppercase text-xs active:scale-95 transition-all mt-2"
          >
            <Navigation size={16} /> Open in Maps
          </a>
        </section>

        {/* Contact */}
        <div className="grid grid-cols-2 gap-3">
          {order.customer.phone && (
            <a href={`tel:${order.customer.phone}`} className="flex items-center justify-center gap-2 py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs active:scale-95 transition-all">
              <Phone size={16} /> Call
            </a>
          )}
          {order.customer.phone && (
            <a href={`sms:${order.customer.phone}`} className="flex items-center justify-center gap-2 py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs active:scale-95 transition-all">
              <MessageCircle size={16} /> Text
            </a>
          )}
        </div>

        {/* Admin Notes */}
        {isAdmin && (
          <section className="p-5 bg-white border border-stone-100 rounded-[28px] shadow-sm space-y-3">
            <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest">Admin Notes</p>
            {order.adminNotes && (
              <div className="bg-stone-50 rounded-xl p-3">
                <p className="text-xs text-stone-600 leading-relaxed whitespace-pre-line">{order.adminNotes}</p>
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder="Add note..."
                className="flex-1 bg-stone-50 border border-stone-100 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-black transition-all"
              />
              <button onClick={handleAddAdminNote} className="px-4 py-3 bg-black text-white rounded-xl font-black text-xs uppercase">Add</button>
            </div>
          </section>
        )}

        {/* Reassign (admin/manager) */}
        {isAdmin && (
          <section className="p-5 bg-white border border-stone-100 rounded-[28px] shadow-sm space-y-3">
            <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest">Reassign Driver</p>
            <p className="text-xs text-stone-500">Currently: <span className="font-black text-stone-800">{order.driverName || 'Unassigned'}</span></p>
            <div className="flex gap-2">
              <select
                value={reassignTo}
                onChange={(e) => setReassignTo(e.target.value)}
                className="flex-1 bg-stone-50 border border-stone-100 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-black"
              >
                <option value="">Select driver...</option>
                {allUsers.filter(u => u.role === 'DRIVER' && u.isActive).map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              <button onClick={handleReassign} disabled={!reassignTo} className="px-4 py-3 bg-black text-white rounded-xl font-black text-xs uppercase disabled:opacity-40">Assign</button>
            </div>
          </section>
        )}

        {/* Fees (admin only) */}
        {isAdmin && (
          <section className="p-5 bg-stone-50 border border-stone-100 rounded-[28px] space-y-2">
            <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest">Delivery Fee</p>
            <p className="text-2xl font-black text-stone-900">${order.deliveryFee.toFixed(2)}</p>
            <p className="text-xs text-stone-400">ZIP {order.address.zip}</p>
          </section>
        )}

        {/* ── DRIVER ACTIONS (only if not completed) ── */}
        {!isCompleted && (
          <section className="space-y-3">
            <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest px-1">Proof of Delivery</p>

            {/* Photo */}
            <input type="file" accept="image/*" capture="environment" ref={fileInputRef} onChange={handlePhoto} className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`w-full py-6 rounded-[28px] font-black uppercase tracking-wider text-sm flex items-center justify-center gap-3 active:scale-95 transition-all shadow-sm ${photoData ? 'bg-green-50 text-green-700 border-2 border-green-200' : 'bg-stone-100 text-stone-700'}`}
            >
              <Camera size={22} />
              {photoData ? '✓ PHOTO TAKEN — RETAKE' : 'TAKE PHOTO'}
            </button>

            {photoData && <img src={photoData} className="w-full rounded-[20px] object-cover max-h-48 border border-stone-100" alt="POD" />}

            {/* Signature */}
            <button
              onClick={() => setIsSigning(true)}
              className={`w-full py-6 rounded-[28px] font-black uppercase tracking-wider text-sm flex items-center justify-center gap-3 active:scale-95 transition-all shadow-sm ${sigData ? 'bg-green-50 text-green-700 border-2 border-green-200' : 'bg-stone-100 text-stone-700'}`}
            >
              <PenTool size={22} />
              {sigData ? '✓ SIGNED — REDO' : 'GET SIGNATURE (OPTIONAL)'}
            </button>

            {/* Driver note */}
            <textarea
              value={driverNote}
              onChange={(e) => setDriverNote(e.target.value)}
              placeholder="Delivery notes (optional)..."
              rows={2}
              className="w-full bg-stone-50 border border-stone-100 rounded-[20px] px-5 py-4 text-sm font-medium outline-none focus:border-black transition-all resize-none"
            />

            {/* Complete */}
            <button
              onClick={handleComplete}
              className="w-full py-7 bg-green-500 text-white rounded-[32px] font-black uppercase tracking-widest text-base shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all"
            >
              <CheckCircle2 size={24} /> COMPLETE DELIVERY
            </button>

            {/* Failed */}
            <button
              onClick={() => setShowFailMenu(true)}
              className="w-full py-6 bg-white border-2 border-red-200 text-red-500 rounded-[28px] font-black uppercase tracking-widest text-sm flex items-center justify-center gap-3 active:scale-95 transition-all"
            >
              <XCircle size={20} /> MARK AS FAILED
            </button>
          </section>
        )}

        {/* ── COMPLETED STATE ── */}
        {isCompleted && (
          <section className="space-y-4">
            <div className={`p-5 rounded-[28px] border space-y-3 ${order.status === DeliveryStatus.DELIVERED ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <p className={`text-[9px] font-black uppercase tracking-widest ${order.status === DeliveryStatus.DELIVERED ? 'text-green-600' : 'text-red-500'}`}>
                {order.status === DeliveryStatus.DELIVERED ? 'Delivery Completed' : 'Delivery Failed'}
              </p>
              {order.completedAt && <p className="text-xs font-bold text-stone-600">Completed: {formatDate(order.completedAt)} at {formatTime(order.completedAt)}</p>}
              {order.submittedAt && <p className="text-xs font-bold text-stone-500">Submitted: {formatTime(order.submittedAt)}</p>}
              {order.driverNotes && <p className="text-xs italic text-stone-600">"{order.driverNotes}"</p>}
            </div>

            {order.confirmationPhoto && (
              <img src={order.confirmationPhoto} className="w-full rounded-[20px] object-cover max-h-48 border border-stone-100" alt="Delivery photo" />
            )}
            {order.confirmationSignature && (
              <div className="bg-white border border-stone-100 rounded-[20px] p-3">
                <p className="text-[9px] font-black uppercase text-stone-400 mb-2">Signature</p>
                <img src={order.confirmationSignature} className="w-full max-h-24 object-contain" alt="Signature" />
              </div>
            )}

            {/* Notification section — always visible after completion */}
            <div className="p-5 bg-white border border-stone-100 rounded-[28px] shadow-sm space-y-3">
              <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest">Customer Notification</p>
              {!isWithinSendingHours() && (
                <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-xl border border-amber-100">
                  <Clock size={14} className="text-amber-500" />
                  <p className="text-xs font-black text-amber-700">Sending only allowed 9 AM – 8 PM</p>
                </div>
              )}
              {order.status === DeliveryStatus.DELIVERED && !order.successNotificationSent && (
                <button
                  onClick={() => loadPreview('SUCCESS')}
                  className="w-full py-5 bg-black text-white rounded-[24px] font-black uppercase text-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
                >
                  <Bell size={18} /> Preview & Send Success Message
                </button>
              )}
              {order.status === DeliveryStatus.DELIVERED && order.successNotificationSent && (
                <div className="flex items-center gap-2 p-3 bg-green-50 rounded-xl">
                  <Check size={14} className="text-green-600" />
                  <p className="text-xs font-black text-green-700">Success message sent</p>
                </div>
              )}
              {order.status === DeliveryStatus.FAILED && !order.failureNotificationSent && (
                <button
                  onClick={() => loadPreview('FAILURE')}
                  className="w-full py-5 bg-black text-white rounded-[24px] font-black uppercase text-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
                >
                  <Bell size={18} /> Preview & Send Failure Message
                </button>
              )}
              {order.status === DeliveryStatus.FAILED && order.failureNotificationSent && (
                <div className="flex items-center gap-2 p-3 bg-green-50 rounded-xl">
                  <Check size={14} className="text-green-600" />
                  <p className="text-xs font-black text-green-700">Reschedule message sent with Katie's number</p>
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {/* Failure menu */}
      {showFailMenu && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-end">
          <div className="w-full bg-white rounded-t-[40px] p-6 space-y-4 animate-in slide-in-from-bottom">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-black uppercase">Why did it fail?</h3>
              <button onClick={() => setShowFailMenu(false)}><X size={24} className="text-stone-400" /></button>
            </div>
            <select
              value={failReason}
              onChange={(e) => setFailReason(e.target.value as FailureReason)}
              className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-5 py-4 text-sm font-black outline-none"
            >
              <option value="NOT_HOME">Not Home</option>
              <option value="BAD_ADDRESS">Bad Address</option>
              <option value="REFUSED">Refused Delivery</option>
              <option value="CONCIERGE_REJECTED">Concierge Rejected</option>
              <option value="GATE_CODE_MISSING">Gate Code Missing</option>
              <option value="RECIPIENT_UNAVAILABLE">Recipient Unavailable</option>
              <option value="LEFT_WITH_NEIGHBOR">Left with Neighbor</option>
              <option value="OTHER">Other</option>
            </select>
            <textarea
              value={driverNote}
              onChange={(e) => setDriverNote(e.target.value)}
              placeholder="Additional notes..."
              rows={2}
              className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-5 py-4 text-sm font-medium outline-none resize-none"
            />
            <button
              onClick={handleFailed}
              className="w-full py-6 bg-red-500 text-white rounded-[28px] font-black uppercase text-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              <XCircle size={20} /> SUBMIT FAILED DELIVERY
            </button>
          </div>
        </div>
      )}

      {/* Notify preview modal */}
      {showNotifyPreview && (
        <div className="fixed inset-0 bg-black/70 z-[200] flex items-end p-4">
          <div className="w-full bg-white rounded-[36px] p-6 space-y-4 animate-in slide-in-from-bottom">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black uppercase">Preview Message</h3>
              <button onClick={() => setShowNotifyPreview(null)}><X size={22} className="text-stone-400" /></button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase bg-stone-100 px-3 py-1 rounded-full text-stone-600">Sending via {notifyChannel}</span>
            </div>
            <div className="bg-stone-50 rounded-2xl p-4">
              <p className="text-sm text-stone-700 leading-relaxed">{notifyPreviewText}</p>
            </div>
            {notifySent ? (
              <div className="flex items-center justify-center gap-2 py-5 bg-green-50 rounded-[24px]">
                <Check size={20} className="text-green-600" />
                <span className="font-black text-green-700 uppercase">Message Sent!</span>
              </div>
            ) : (
              <button
                onClick={handleSend}
                disabled={isSendingNotify || !isWithinSendingHours()}
                className="w-full py-7 bg-green-500 text-white rounded-[32px] font-black uppercase tracking-widest text-lg flex items-center justify-center gap-3 active:scale-95 transition-all disabled:opacity-50 shadow-xl"
              >
                {isSendingNotify ? <RefreshCw size={22} className="animate-spin" /> : <Send size={22} />}
                SEND
              </button>
            )}
          </div>
        </div>
      )}

      {isSigning && (
        <SignaturePad
          onSave={(sig) => { setSigData(sig); setIsSigning(false); }}
          onCancel={() => setIsSigning(false)}
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULE VIEW — day/week/month/custom
// ─────────────────────────────────────────────────────────────────────────────

const ScheduleView: React.FC<{
  deliveries: Delivery[];
  role: AppRole;
  currentUserId: string;
  onSelectOrder: (order: Delivery) => void;
}> = ({ deliveries, role, currentUserId, onSelectOrder }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('DAY');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [customStart, setCustomStart] = useState(new Date().toISOString().split('T')[0]);
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().split('T')[0]);
  const [filterDriver, setFilterDriver] = useState('ALL');
  const isAdmin = role === 'SUPER_ADMIN' || role === 'MANAGER';

  const getDateRange = (): [string, string] => {
    const d = new Date(selectedDate);
    if (viewMode === 'DAY') {
      return [selectedDate, selectedDate];
    } else if (viewMode === 'WEEK') {
      const start = new Date(d);
      start.setDate(d.getDate() - d.getDay());
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return [start.toISOString().split('T')[0], end.toISOString().split('T')[0]];
    } else if (viewMode === 'MONTH') {
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return [start.toISOString().split('T')[0], end.toISOString().split('T')[0]];
    } else {
      return [customStart, customEnd];
    }
  };

  const [rangeStart, rangeEnd] = getDateRange();

  const filtered = useMemo(() => {
    return deliveries.filter(d => {
      const date = d.deliveryDate?.split('T')[0] || new Date().toISOString().split('T')[0];
      const inRange = date >= rangeStart && date <= rangeEnd;
      const myOrder = !isAdmin ? d.driverId === currentUserId : true;
      const driverMatch = isAdmin && filterDriver !== 'ALL' ? d.driverId === filterDriver : true;
      return inRange && myOrder && driverMatch;
    });
  }, [deliveries, rangeStart, rangeEnd, currentUserId, isAdmin, filterDriver]);

  // Group by date
  const grouped = useMemo(() => {
    const map: Record<string, Delivery[]> = {};
    filtered.forEach(d => {
      const date = d.deliveryDate?.split('T')[0] || new Date().toISOString().split('T')[0];
      if (!map[date]) map[date] = [];
      map[date].push(d);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const drivers = useMemo(() => {
    const seen = new Set<string>();
    const list: { id: string; name: string }[] = [];
    deliveries.forEach(d => {
      if (d.driverId && !seen.has(d.driverId)) {
        seen.add(d.driverId);
        list.push({ id: d.driverId, name: d.driverName || d.driverId });
      }
    });
    return list;
  }, [deliveries]);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* View toggle */}
      <div className="sticky top-0 bg-white z-10 border-b border-stone-100 p-4 space-y-3">
        <div className="flex gap-2">
          {(['DAY', 'WEEK', 'MONTH', 'CUSTOM'] as ViewMode[]).map(m => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={`flex-1 py-2 rounded-xl font-black uppercase text-[10px] transition-all ${viewMode === m ? 'bg-black text-white' : 'bg-stone-100 text-stone-500'}`}
            >{m}</button>
          ))}
        </div>
        {viewMode === 'CUSTOM' ? (
          <div className="flex gap-2">
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              className="flex-1 bg-stone-50 border border-stone-100 rounded-xl px-3 py-2 text-xs font-black outline-none" />
            <span className="self-center text-stone-400 font-black text-xs">to</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              className="flex-1 bg-stone-50 border border-stone-100 rounded-xl px-3 py-2 text-xs font-black outline-none" />
          </div>
        ) : (
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
            className="w-full bg-stone-50 border border-stone-100 rounded-xl px-4 py-3 text-sm font-black outline-none text-center" />
        )}
        {isAdmin && drivers.length > 0 && (
          <select value={filterDriver} onChange={e => setFilterDriver(e.target.value)}
            className="w-full bg-stone-50 border border-stone-100 rounded-xl px-4 py-3 text-sm font-medium outline-none">
            <option value="ALL">All Drivers</option>
            {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto pb-24">
        {grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Calendar size={36} className="text-stone-200 mb-3" />
            <p className="text-[11px] font-black uppercase text-stone-300">No deliveries in this range</p>
          </div>
        ) : (
          grouped.map(([date, orders]) => (
            <div key={date}>
              <div className="px-5 py-3 bg-stone-50 border-b border-stone-100">
                <p className="text-[11px] font-black uppercase text-stone-500 tracking-widest">
                  {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                  <span className="ml-2 text-stone-400">({orders.length} {orders.length === 1 ? 'delivery' : 'deliveries'})</span>
                </p>
              </div>
              {orders.map(order => (
                <OrderCard
                  key={order.id}
                  order={order}
                  role={role}
                  onTap={() => onSelectOrder(order)}
                  isSelected={false}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN PANEL — drivers, templates, fees
// ─────────────────────────────────────────────────────────────────────────────

const AdminPanel: React.FC<{
  role: AppRole;
  deliveries: Delivery[];
  onRefresh: () => void;
}> = ({ role, deliveries, onRefresh }) => {
  const [activeTab, setActiveTab] = useState<'DRIVERS' | 'TEMPLATES' | 'FEES'>('DRIVERS');
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [newDriver, setNewDriver] = useState({ name: '', pin: '', phone: '', vehicle: '' });
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');
  const [resetPinId, setResetPinId] = useState<string | null>(null);
  const [newPinVal, setNewPinVal] = useState('');
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [templateEdits, setTemplateEdits] = useState<Record<string, string>>({});
  const [feeZip, setFeeZip] = useState('');
  const [feeResult, setFeeResult] = useState<number | null>(null);
  const [feeStart, setFeeStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]; });
  const [feeEnd, setFeeEnd] = useState(() => new Date().toISOString().split('T')[0]);
  const isSuperAdmin = role === 'SUPER_ADMIN';

  useEffect(() => {
    fetch('/api/users').then(r => r.json()).then(d => setUsers(d.users || []));
    fetch('/api/templates').then(r => r.json()).then(d => setTemplates(d.templates || []));
  }, []);

  const handleAddDriver = async () => {
    setAddError(''); setAddSuccess('');
    if (!newDriver.name || !newDriver.pin) { setAddError('Name and PIN are required'); return; }
    if (newDriver.pin.length !== 4) { setAddError('PIN must be 4 digits'); return; }
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newDriver, role: 'DRIVER' })
    });
    const data = await res.json();
    if (!res.ok) { setAddError(data.error); return; }
    setUsers(prev => [...prev, data.user]);
    setNewDriver({ name: '', pin: '', phone: '', vehicle: '' });
    setAddSuccess(`${data.user.name} added successfully!`);
    setTimeout(() => setAddSuccess(''), 3000);
  };

  const toggleActive = async (user: UserAccount) => {
    const res = await fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !user.isActive })
    });
    const data = await res.json();
    setUsers(prev => prev.map(u => u.id === user.id ? data.user : u));
  };

  const handleResetPin = async (userId: string) => {
    if (newPinVal.length !== 4) { alert('Must be 4 digits'); return; }
    await fetch(`/api/users/${userId}/reset-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPin: newPinVal })
    });
    setResetPinId(null);
    setNewPinVal('');
    alert('PIN reset successfully');
  };

  const handleSaveTemplate = async (id: string) => {
    const body = templateEdits[id];
    if (!body) return;
    const res = await fetch(`/api/templates/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body })
    });
    const data = await res.json();
    setTemplates(prev => prev.map(t => t.id === id ? data.template : t));
    setEditingTemplate(null);
  };

  const totalFees = deliveries
    .filter(d => d.status === DeliveryStatus.DELIVERED && d.completedAt)
    .filter(d => { const dt = d.completedAt!.split('T')[0]; return dt >= feeStart && dt <= feeEnd; })
    .reduce((s, d) => s + (d.deliveryFee || 0), 0);

  const drivers = users.filter(u => u.role === 'DRIVER');

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Tabs */}
      <div className="sticky top-0 bg-white z-10 border-b border-stone-100 px-4 pt-4 pb-0">
        <div className="flex gap-1 bg-stone-100 rounded-2xl p-1">
          {(['DRIVERS', 'TEMPLATES', 'FEES'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 rounded-xl font-black uppercase text-[10px] transition-all ${activeTab === tab ? 'bg-white text-black shadow-sm' : 'text-stone-400'}`}
            >{tab}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 pb-28">

        {/* DRIVERS TAB */}
        {activeTab === 'DRIVERS' && (
          <div className="space-y-5">
            {/* Add new driver */}
            <div className="p-5 bg-white border border-stone-100 rounded-[28px] shadow-sm space-y-3">
              <div className="flex items-center gap-2">
                <UserPlus size={18} className="text-stone-500" />
                <p className="font-black uppercase text-sm text-stone-800">Add Driver</p>
              </div>
              <input
                type="text" placeholder="Name" value={newDriver.name}
                onChange={e => setNewDriver(p => ({ ...p, name: e.target.value }))}
                className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-black"
              />
              <input
                type="text" placeholder="4-digit PIN" maxLength={4} inputMode="numeric" value={newDriver.pin}
                onChange={e => setNewDriver(p => ({ ...p, pin: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-black"
              />
              <input
                type="tel" placeholder="Phone (optional)" value={newDriver.phone}
                onChange={e => setNewDriver(p => ({ ...p, phone: e.target.value }))}
                className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-black"
              />
              <input
                type="text" placeholder="Vehicle (optional)" value={newDriver.vehicle}
                onChange={e => setNewDriver(p => ({ ...p, vehicle: e.target.value }))}
                className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-black"
              />
              {addError && <p className="text-xs font-black text-red-500">{addError}</p>}
              {addSuccess && <p className="text-xs font-black text-green-600">{addSuccess}</p>}
              <button onClick={handleAddDriver}
                className="w-full py-5 bg-black text-white rounded-[24px] font-black uppercase tracking-widest active:scale-95 transition-all"
              >Add Driver</button>
            </div>

            {/* Driver list */}
            {drivers.map(u => (
              <div key={u.id} className={`p-5 bg-white border rounded-[28px] shadow-sm space-y-3 ${u.isActive ? 'border-stone-100' : 'border-stone-200 opacity-60'}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-black text-stone-900">{u.name}</p>
                    <p className="text-xs text-stone-400 font-medium">{u.phone || 'No phone'} • {u.vehicle || 'No vehicle'}</p>
                  </div>
                  <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-500'}`}>
                    {u.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => toggleActive(u)}
                    className={`flex-1 py-3 rounded-2xl font-black uppercase text-xs ${u.isActive ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600'}`}
                  >{u.isActive ? 'Deactivate' : 'Activate'}</button>
                  <button onClick={() => { setResetPinId(u.id); setNewPinVal(''); }}
                    className="flex-1 py-3 bg-stone-100 text-stone-700 rounded-2xl font-black uppercase text-xs"
                  >Reset PIN</button>
                </div>
                {resetPinId === u.id && (
                  <div className="flex gap-2 mt-1">
                    <input
                      type="text" placeholder="New PIN" maxLength={4} inputMode="numeric" value={newPinVal}
                      onChange={e => setNewPinVal(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      className="flex-1 bg-stone-50 border border-stone-100 rounded-xl px-4 py-3 text-sm font-black outline-none text-center tracking-widest"
                    />
                    <button onClick={() => handleResetPin(u.id)}
                      className="px-4 py-3 bg-black text-white rounded-xl font-black text-xs uppercase">Save</button>
                    <button onClick={() => setResetPinId(null)}
                      className="px-4 py-3 bg-stone-100 text-stone-500 rounded-xl font-black text-xs uppercase">Cancel</button>
                  </div>
                )}
              </div>
            ))}

            {drivers.length === 0 && (
              <div className="text-center py-12">
                <Users size={32} className="mx-auto text-stone-200 mb-2" />
                <p className="text-[11px] font-black uppercase text-stone-300">No drivers added yet</p>
              </div>
            )}
          </div>
        )}

        {/* TEMPLATES TAB */}
        {activeTab === 'TEMPLATES' && (
          <div className="space-y-5">
            <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100">
              <p className="text-xs font-black text-amber-700">Use these variables in messages:</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {['{{customer_name}}', '{{order_number}}', '{{driver_name}}', '{{address}}', '{{katie_phone}}'].map(v => (
                  <span key={v} className="text-[10px] font-black bg-white border border-amber-200 rounded-lg px-2 py-1 text-amber-700">{v}</span>
                ))}
              </div>
            </div>
            {templates.map(t => (
              <div key={t.id} className="p-5 bg-white border border-stone-100 rounded-[28px] shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-black text-stone-900">{t.label}</p>
                  <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full ${t.id === 'SUCCESS' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                    {t.id}
                  </span>
                </div>
                {editingTemplate === t.id ? (
                  <>
                    <textarea
                      value={templateEdits[t.id] ?? t.body}
                      onChange={e => setTemplateEdits(prev => ({ ...prev, [t.id]: e.target.value }))}
                      rows={5}
                      className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-black resize-none"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => handleSaveTemplate(t.id)}
                        className="flex-1 py-3 bg-black text-white rounded-2xl font-black uppercase text-xs">Save</button>
                      <button onClick={() => setEditingTemplate(null)}
                        className="flex-1 py-3 bg-stone-100 text-stone-500 rounded-2xl font-black uppercase text-xs">Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-stone-600 leading-relaxed bg-stone-50 rounded-xl p-3">{t.body}</p>
                    <button onClick={() => { setEditingTemplate(t.id); setTemplateEdits(prev => ({ ...prev, [t.id]: t.body })); }}
                      className="w-full py-3 bg-stone-100 text-stone-700 rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-2"
                    ><Edit3 size={14} /> Edit Template</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* FEES TAB */}
        {activeTab === 'FEES' && (
          <div className="space-y-5">
            {/* Summary */}
            <div className="p-5 bg-white border border-stone-100 rounded-[28px] shadow-sm space-y-4">
              <p className="font-black uppercase text-sm text-stone-800 flex items-center gap-2"><FileText size={16} /> Revenue Summary</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[8px] font-black uppercase text-stone-400 mb-1 block">Start</label>
                  <input type="date" value={feeStart} onChange={e => setFeeStart(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-100 rounded-xl px-3 py-2 text-xs font-black outline-none" />
                </div>
                <div>
                  <label className="text-[8px] font-black uppercase text-stone-400 mb-1 block">End</label>
                  <input type="date" value={feeEnd} onChange={e => setFeeEnd(e.target.value)}
                    className="w-full bg-stone-50 border border-stone-100 rounded-xl px-3 py-2 text-xs font-black outline-none" />
                </div>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-stone-50">
                <span className="text-sm font-black uppercase text-stone-400">Total Delivery Fees</span>
                <span className="text-3xl font-black text-stone-900">${totalFees.toFixed(2)}</span>
              </div>
            </div>

            {/* Fee calculator */}
            <div className="p-5 bg-white border border-stone-100 rounded-[28px] shadow-sm space-y-4">
              <p className="font-black uppercase text-sm text-stone-800 flex items-center gap-2"><MapPin size={16} /> Rate Calculator</p>
              <div className="flex gap-2">
                <input
                  type="text" placeholder="Enter ZIP code" value={feeZip}
                  onChange={e => setFeeZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
                  className="flex-1 bg-stone-50 border border-stone-100 rounded-2xl px-4 py-4 text-lg font-black outline-none focus:border-black text-center tracking-widest"
                />
                <button
                  onClick={() => setFeeResult(DELIVERY_FEES[feeZip] ?? null)}
                  className="px-5 py-4 bg-black text-white rounded-2xl font-black uppercase text-xs"
                >Check</button>
              </div>
              {feeResult !== null && (
                <div className="flex items-center justify-between p-4 bg-green-50 rounded-2xl border border-green-100">
                  <span className="font-black text-stone-700 uppercase text-sm">ZIP {feeZip}</span>
                  <span className="text-2xl font-black text-green-700">${feeResult}</span>
                </div>
              )}
              {feeZip.length === 5 && feeResult === null && (
                <p className="text-xs font-black text-red-400 text-center">ZIP not in rate table</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => {
    try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch { return null; }
  });
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [allUsers, setAllUsers] = useState<UserAccount[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Delivery | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<'LIVE' | 'MOCK' | 'ERROR'>('MOCK');
  const [tab, setTab] = useState<'SCHEDULE' | 'ADMIN'>('SCHEDULE');

  const isAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'MANAGER';

  useEffect(() => {
    if (currentUser) {
      fetchOrders();
      fetch('/api/users').then(r => r.json()).then(d => setAllUsers(d.users || []));
      const interval = setInterval(fetchOrders, 300000);
      return () => clearInterval(interval);
    }
  }, [currentUser]);

  const fetchOrders = async () => {
    setIsLoading(true);
    try {
      const fetched = await getDeliveries();
      setDeliveries(fetched);
      setDataSource(fetched.some((d: Delivery) => d.id === '33989') ? 'MOCK' : 'LIVE');
      setLastSync(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch {
      setDataSource('ERROR');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateOrder = useCallback((id: string, updates: Partial<Delivery>) => {
    setDeliveries(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d));
    if (selectedOrder?.id === id) setSelectedOrder(prev => prev ? { ...prev, ...updates } : null);
  }, [selectedOrder]);

  const logout = () => {
    localStorage.removeItem('currentUser');
    setCurrentUser(null);
    setDeliveries([]);
    setSelectedOrder(null);
  };

  if (!currentUser) {
    return (
      <LoginGate onAuthorized={(user) => {
        setCurrentUser(user);
        localStorage.setItem('currentUser', JSON.stringify(user));
      }} />
    );
  }

  if (selectedOrder) {
    return (
      <div className="max-w-md mx-auto min-h-screen bg-white">
        <OrderDetail
          order={selectedOrder}
          role={currentUser.role}
          currentUser={currentUser}
          allUsers={allUsers}
          onUpdate={handleUpdateOrder}
          onBack={() => setSelectedOrder(null)}
        />
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto min-h-screen bg-white flex flex-col relative border-x border-stone-50">
      {/* Top bar */}
      <div className="bg-white border-b border-stone-100 py-3 px-5 flex items-center justify-between shadow-sm sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <img src={BRAND_LOGO} alt="Sweet Tooth" className="h-10 w-auto object-contain" />
          <div>
            <p className="text-[9px] font-black uppercase text-stone-400 leading-none">{currentUser.role.replace('_', ' ')}</p>
            <p className="text-sm font-black text-stone-900 leading-tight">{currentUser.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isLoading ? 'bg-amber-400 animate-pulse' : dataSource === 'LIVE' ? 'bg-green-500' : 'bg-red-400'}`} />
            <span className="text-[8px] font-black uppercase text-stone-400">{lastSync || 'syncing'}</span>
          </div>
          <button onClick={fetchOrders} className={`p-2 text-stone-400 ${isLoading ? 'animate-spin' : ''}`}><RefreshCw size={16} /></button>
          <button onClick={logout} className="p-2 text-stone-400 hover:text-red-500 transition-colors"><LogOut size={18} /></button>
        </div>
      </div>

      {/* Tab nav */}
      {isAdmin && (
        <div className="flex border-b border-stone-100 bg-white sticky top-[57px] z-40">
          <button
            onClick={() => setTab('SCHEDULE')}
            className={`flex-1 py-3 font-black uppercase text-[11px] flex items-center justify-center gap-1.5 transition-all ${tab === 'SCHEDULE' ? 'text-black border-b-2 border-black' : 'text-stone-400'}`}
          ><Calendar size={14} /> Schedule</button>
          <button
            onClick={() => setTab('ADMIN')}
            className={`flex-1 py-3 font-black uppercase text-[11px] flex items-center justify-center gap-1.5 transition-all ${tab === 'ADMIN' ? 'text-black border-b-2 border-black' : 'text-stone-400'}`}
          ><Settings size={14} /> Admin</button>
        </div>
      )}

      {/* Content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {(tab === 'SCHEDULE' || !isAdmin) && (
          <ScheduleView
            deliveries={deliveries}
            role={currentUser.role}
            currentUserId={currentUser.id}
            onSelectOrder={setSelectedOrder}
          />
        )}
        {tab === 'ADMIN' && isAdmin && (
          <AdminPanel
            role={currentUser.role}
            deliveries={deliveries}
            onRefresh={fetchOrders}
          />
        )}
      </main>
    </div>
  );
}
