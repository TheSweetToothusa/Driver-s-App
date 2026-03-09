import React, { useState, useEffect, useMemo, useRef } from 'react';
import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { 
  Package, Truck, ChevronRight, X, Check, RefreshCw, 
  LogOut, Calendar, MapPin, Phone, MessageSquare,
  Navigation, CheckCircle2, Send, ShieldCheck, 
  MessageCircle, AlertTriangle, Eye, Camera, PenTool, Share2, Mail, Home, MapPinned, Trash2, Wifi, Copy, Smartphone, Info, Settings, HelpCircle, ExternalLink, Lock, Key, Globe, Download, Zap, EyeOff, AlertCircle, FileText, Share, Sparkles, Volume2, Map, Filter, ArrowRightLeft, ListFilter
} from 'lucide-react';
import { Delivery, DeliveryStatus, AppRole, ChatMessage, FailureReason, ManualStop } from './types';
import { getDeliveries } from './services/shopifyService';
import { DELIVERY_FEES, PER_MILE_RATE } from './src/constants';

const BRAND_LOGO = "https://cdn.shopify.com/s/files/1/0559/8498/0141/files/The_Sweet_Tooth_Chocolate_Factory_Logo.png?v=1759286605";
const ACCESS_PASSCODE = "2025"; 

// --- UTILS ---

const base64ToBlob = (base64: string, mimeType: string) => {
  const byteString = atob(base64.split(',')[1]);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeType });
};

// --- CONNECTION STATUS COMPONENT ---

const ConnectionStatus: React.FC<{ source: 'LIVE' | 'MOCK' | 'ERROR', lastSync: string | null }> = ({ source, lastSync }) => {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-stone-100/50 border-b border-stone-100">
      <div className="flex items-center gap-2">
        <div className={`w-1.5 h-1.5 rounded-full ${source === 'LIVE' ? 'bg-green-500 animate-pulse' : source === 'MOCK' ? 'bg-amber-500' : 'bg-red-500'}`} />
        <span className="text-[9px] font-black uppercase tracking-widest text-stone-500">
          {source === 'LIVE' ? 'Shopify Live' : source === 'MOCK' ? 'Mock Environment' : 'Sync Error'}
        </span>
      </div>
      {lastSync && (
        <span className="text-[9px] font-bold text-stone-400 uppercase">
          Updated {lastSync}
        </span>
      )}
    </div>
  );
};

// --- POD COMPONENTS ---

const SignaturePad: React.FC<{ onSave: (dataUrl: string) => void, onCancel: () => void }> = ({ onSave, onCancel }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

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
      setIsDrawing(true);
      const { x, y } = getPos(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
    };

    const move = (e: MouseEvent | TouchEvent) => {
      if (!isDrawing) return;
      e.preventDefault();
      const { x, y } = getPos(e);
      ctx.lineTo(x, y);
      ctx.stroke();
    };

    const stop = () => setIsDrawing(false);

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
  }, [isDrawing]);

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/90 z-[300] flex flex-col p-6 animate-in fade-in">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-white font-black uppercase tracking-widest text-xs">Recipient Signature</h3>
        <button onClick={onCancel} className="text-white/50"><X size={24} /></button>
      </div>
      <div className="flex-1 bg-white rounded-3xl overflow-hidden relative border-4 border-white">
        <canvas ref={canvasRef} width={400} height={600} className="w-full h-full touch-none" />
        <div className="absolute bottom-4 left-0 right-0 text-center pointer-events-none">
          <p className="text-[10px] font-black uppercase text-stone-300 tracking-widest">Sign inside the box</p>
        </div>
      </div>
      <div className="mt-6 flex gap-3">
        <button onClick={handleClear} className="flex-1 py-5 bg-white/10 text-white rounded-2xl font-black uppercase text-[10px]">Clear</button>
        <button 
          onClick={() => canvasRef.current && onSave(canvasRef.current.toDataURL())}
          className="flex-2 py-5 bg-white text-black rounded-2xl font-black uppercase text-[10px]"
        >
          Confirm Signature
        </button>
      </div>
    </div>
  );
};

// --- SHARE MODAL ---

const SharePodModal: React.FC<{ order: Delivery, onClose: () => void }> = ({ order, onClose }) => {
  const [recipient, setRecipient] = useState(order.customer.email || order.customer.phone || '');
  const [isEmail, setIsEmail] = useState(recipient.includes('@'));

  const shareText = `The Sweet Tooth: Proof of Delivery for Order ${order.orderNumber}. Delivered to ${order.customer.name} at ${order.completedAt}. Address: ${order.address.street}, ${order.address.city}.`;

  const handleEmail = () => {
    const subject = encodeURIComponent(`Proof of Delivery - Order ${order.orderNumber}`);
    const body = encodeURIComponent(`${shareText}\n\nNotes: ${order.driverNotes || 'None'}`);
    window.location.href = `mailto:${recipient}?subject=${subject}&body=${body}`;
  };

  const handleSms = () => {
    const body = encodeURIComponent(shareText);
    window.location.href = `sms:${recipient}${navigator.userAgent.match(/iPhone/i) ? '&' : '?'}body=${body}`;
  };

  const handleNativeShare = async () => {
    if (!navigator.share) return alert("System share not supported on this browser.");
    
    const files: File[] = [];
    if (order.confirmationPhoto?.startsWith('data:')) {
      const blob = base64ToBlob(order.confirmationPhoto, 'image/jpeg');
      files.push(new File([blob], `POD_Photo_${order.orderNumber}.jpg`, { type: 'image/jpeg' }));
    }
    if (order.confirmationSignature?.startsWith('data:')) {
      const blob = base64ToBlob(order.confirmationSignature, 'image/png');
      files.push(new File([blob], `POD_Signature_${order.orderNumber}.png`, { type: 'image/png' }));
    }

    try {
      if (files.length > 0 && navigator.canShare && navigator.canShare({ files })) {
        await navigator.share({
          files,
          title: `POD - Order ${order.orderNumber}`,
          text: shareText
        });
      } else {
        await navigator.share({
          title: `POD - Order ${order.orderNumber}`,
          text: shareText
        });
      }
    } catch (err) {
      console.error("Share failed", err);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[400] flex items-end justify-center p-4 animate-in fade-in">
      <div className="w-full max-w-sm bg-white rounded-[32px] p-8 shadow-2xl animate-in slide-in-from-bottom duration-300">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h3 className="text-xl font-black uppercase tracking-tighter">Share Confirmation</h3>
            <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest">Order {order.orderNumber}</p>
          </div>
          <button onClick={onClose} className="p-2 bg-stone-50 rounded-full"><X size={20} /></button>
        </div>

        <div className="space-y-6">
          <div>
            <label className="text-[9px] font-black uppercase text-stone-400 tracking-widest block mb-2">Recipient Contact</label>
            <input 
              type="text" 
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Email or Phone Number"
              className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-5 py-4 text-sm font-black outline-none focus:border-black transition-all"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button onClick={handleEmail} className="flex flex-col items-center justify-center gap-2 p-5 bg-white border border-stone-100 rounded-[24px] hover:bg-stone-50 transition-colors">
              <div className="w-10 h-10 bg-pink-50 text-pink-500 rounded-full flex items-center justify-center"><Mail size={20} /></div>
              <span className="text-[10px] font-black uppercase">Email POD</span>
            </button>
            <button onClick={handleSms} className="flex flex-col items-center justify-center gap-2 p-5 bg-white border border-stone-100 rounded-[24px] hover:bg-stone-50 transition-colors">
              <div className="w-10 h-10 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center"><MessageCircle size={20} /></div>
              <span className="text-[10px] font-black uppercase">Text POD</span>
            </button>
          </div>

          <button 
            onClick={handleNativeShare}
            className="w-full py-5 bg-black text-white rounded-[24px] font-black uppercase tracking-widest flex items-center justify-center gap-3 active:scale-95 transition-all shadow-xl"
          >
            <Share2 size={18} /> Open System Share
          </button>
        </div>
      </div>
    </div>
  );
};

// --- LOGIN GATE ---

const LoginGate: React.FC<{ onAuthorized: (role: AppRole) => void }> = ({ onAuthorized }) => {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState(false);
  const [showPasscode, setShowPasscode] = useState(false);
  const [selectedRole, setSelectedRole] = useState<AppRole | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (passcode.trim() === ACCESS_PASSCODE && selectedRole) {
      onAuthorized(selectedRole);
    } else {
      setError(true);
      setTimeout(() => {
        setError(false);
        setPasscode("");
      }, 1500);
    }
  };

  if (!selectedRole) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-10 text-center animate-in fade-in duration-500">
        <img src={BRAND_LOGO} className="h-48 mb-12 object-contain" alt="Logo" />
        <h2 className="text-xl font-black text-black tracking-tight mb-8 uppercase">Select Login</h2>
        <div className="w-full max-w-xs space-y-4">
          <button onClick={() => setSelectedRole('ADMIN')} className="w-full py-6 bg-black text-white rounded-[28px] font-black uppercase tracking-widest shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all">
            <ShieldCheck size={20} /> Admin
          </button>
          <button onClick={() => setSelectedRole('DRIVER')} className="w-full py-6 bg-white border-2 border-black text-black rounded-[28px] font-black uppercase tracking-widest flex items-center justify-center gap-3 active:scale-95 transition-all">
            <Truck size={20} /> Driver
          </button>
        </div>
        <p className="mt-12 text-[10px] font-black text-stone-300 uppercase tracking-widest">The Sweet Tooth • Internal Use Only</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-10 animate-in slide-in-from-bottom duration-500">
      <button onClick={() => setSelectedRole(null)} className="absolute top-10 left-10 p-2 text-stone-300"><X size={24} /></button>
      <div className="w-12 h-12 bg-black text-white rounded-2xl flex items-center justify-center mb-6">
        <Lock size={20} />
      </div>
      <h2 className="text-xl font-black text-black tracking-tight mb-2 uppercase text-center">Security Access</h2>
      <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-8 text-center">Enter the 4-digit access code for <span className="text-black">{selectedRole}</span></p>
      
      <form onSubmit={handleSubmit} className="w-full max-w-xs relative">
        <div className="relative">
          <input 
            autoFocus
            autoComplete="off"
            type={showPasscode ? "text" : "password"}
            inputMode="numeric"
            pattern="[0-9]*"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="0000"
            maxLength={4}
            className={`w-full bg-stone-50 border-2 rounded-[24px] px-6 py-5 text-center text-4xl font-black tracking-[0.5em] outline-none transition-all ${error ? 'border-red-500 animate-shake' : 'border-stone-100 focus:border-black'}`}
          />
          <button 
            type="button"
            onClick={() => setShowPasscode(!showPasscode)}
            className="absolute right-6 top-1/2 -translate-y-1/2 text-stone-300"
          >
            {showPasscode ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        {error && <p className="text-[10px] font-black text-red-500 uppercase mt-4 text-center">Invalid Passcode</p>}
        <button type="submit" className="w-full mt-6 py-5 bg-black text-white rounded-[24px] font-black uppercase tracking-widest shadow-lg active:scale-95 transition-all">
          Unlock Portal
        </button>
      </form>
      <p className="mt-12 text-[8px] font-black text-stone-300 uppercase tracking-widest text-center max-w-[200px] leading-relaxed">
        Activity is monitored and recorded for security.
      </p>
    </div>
  );
};

// --- UI COMPONENTS ---

const Header: React.FC<{ onLogout: () => void, onLogoClick: () => void, lastSync: string | null, isSyncing: boolean }> = ({ onLogout, onLogoClick, lastSync, isSyncing }) => (
  <div className="bg-white border-b border-stone-100 py-4 px-6 sticky top-0 z-[100] flex items-center justify-between shadow-sm">
    <div 
      onClick={onLogoClick} 
      className="flex items-center cursor-pointer hover:opacity-70 active:scale-95 transition-all"
    >
      <img src={BRAND_LOGO} alt="The Sweet Tooth" className="h-12 w-auto object-contain" />
    </div>
    
    <div className="flex items-center gap-4">
      {lastSync && (
        <div className="flex flex-col items-end mr-2">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isSyncing ? 'bg-pink-400 animate-pulse' : 'bg-green-500'}`}></span>
            <span className="text-[8px] font-black uppercase text-stone-400 tracking-widest">Shopify Live</span>
          </div>
          <p className="text-[7px] font-bold text-stone-300 uppercase">Updated {lastSync}</p>
        </div>
      )}
      <button onClick={onLogout} className="p-2 text-stone-400 hover:text-red-500 transition-colors">
        <LogOut size={18} />
      </button>
    </div>
  </div>
);

const DateHeader: React.FC<{ selectedDate: Date }> = ({ selectedDate }) => {
  const isToday = new Date().toDateString() === selectedDate.toDateString();
  const displayDate = selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <div className="mb-6">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-400 mb-1">
        {isToday ? "Today's Schedule" : "Schedule for"}
      </p>
      <h1 className="text-2xl font-black text-black tracking-tight">{displayDate}</h1>
    </div>
  );
};

const OrderRow: React.FC<{ order: Delivery, isSelected: boolean, onSelect: () => void, onView: () => void }> = ({ order, isSelected, onSelect, onView }) => {
  const totalAmount = order.items.reduce((sum, item) => sum + (item.price * item.quantity), 0) + order.deliveryFee;
  const statusColor = order.status === DeliveryStatus.DELIVERED ? 'bg-black text-white' : 
                      order.status === DeliveryStatus.FAILED ? 'bg-red-500 text-white' :
                      order.status === DeliveryStatus.IN_TRANSIT ? 'bg-[#FDF0F6] text-black border border-pink-200' : 'bg-stone-100 text-stone-500';
  
  return (
    <div 
      onClick={onSelect}
      className={`p-4 border-b border-stone-50 transition-all cursor-pointer flex items-center justify-between ${isSelected ? 'bg-[#FDF0F6] scale-[1.01] shadow-sm z-10 relative' : 'hover:bg-stone-50'}`}
    >
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-black text-stone-900">{order.orderNumber}</span>
          <span className={`text-[7px] px-1.5 py-0.5 rounded-full font-black uppercase ${statusColor}`}>
            {order.status.replace('_', ' ')}
          </span>
        </div>
        <p className="text-[11px] font-black text-stone-900 truncate max-w-[160px]">{order.customer.name}</p>
        <p className="text-[9px] font-bold text-stone-400 uppercase tracking-tight">{order.address.city}</p>
      </div>
      <div className="flex items-center gap-3">
        <p className="text-[11px] font-black text-stone-900">${totalAmount.toFixed(2)}</p>
        {isSelected ? (
          <button onClick={(e) => { e.stopPropagation(); onView(); }} className="p-2 bg-black text-white rounded-lg shadow-md animate-in zoom-in-50">
            <Eye size={16} />
          </button>
        ) : (
          <ChevronRight size={14} className="text-stone-200" />
        )}
      </div>
    </div>
  );
};

// --- CHAT VIEW ---

const ChatView: React.FC<{ role: AppRole }> = ({ role }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleSend = () => {
    if (!input.trim()) return;
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      senderId: role === 'ADMIN' ? 'admin' : 'driver',
      senderName: role === 'ADMIN' ? 'Dispatch' : 'Driver',
      text: input,
      timestamp: new Date().toISOString(),
      isRead: false
    };
    setMessages([...messages, newMessage]);
    setInput("");
  };

  return (
    <div className="flex flex-col h-full bg-stone-50">
      <div className="p-4 bg-white border-b border-stone-100 shadow-sm">
        <h2 className="text-xl font-black text-black tracking-tighter uppercase">Team Dispatch</h2>
        <p className="text-[8px] font-black text-stone-400 uppercase tracking-widest">Internal Logistics Chat</p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
        {messages.map(msg => (
          <div key={msg.id} className={`flex flex-col ${msg.senderId === (role === 'ADMIN' ? 'admin' : 'driver') ? 'items-end' : 'items-start'}`}>
            <div className={`p-4 rounded-[20px] max-w-[85%] text-sm font-black shadow-sm ${msg.senderId === (role === 'ADMIN' ? 'admin' : 'driver') ? 'bg-black text-white' : 'bg-white border border-stone-100'}`}>
              {msg.text}
            </div>
          </div>
        ))}
      </div>
      <div className="p-4 bg-white border-t border-stone-100 pb-28">
        <div className="relative">
          <input 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type a message..."
            className="w-full bg-stone-50 border border-stone-100 rounded-[24px] px-6 py-4 text-sm font-black outline-none"
          />
          <button onClick={handleSend} className="absolute right-2 top-2 w-10 h-10 bg-black text-white rounded-full flex items-center justify-center">
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

// --- MAIN APP COMPONENT ---

export default function App() {
  const [role, setRole] = useState<AppRole | null>(() => localStorage.getItem('role') as AppRole);
  const [isAuthorized, setIsAuthorized] = useState(() => localStorage.getItem('isAuthorized') === 'true');
  
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Delivery | null>(null);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<'LIVE' | 'MOCK' | 'ERROR'>('MOCK');
  const [tab, setTab] = useState<'DELIVERIES' | 'CHAT' | 'ADMIN'>('DELIVERIES');
  const [isSharingPod, setIsSharingPod] = useState(false);
  
  // Failed Delivery Menu State
  const [isFailedMenuOpen, setIsFailedMenuOpen] = useState(false);
  
  // Admin Fees State
  const [feeStartDate, setFeeStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [feeEndDate, setFeeEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [feeSearchZip, setFeeSearchZip] = useState("");
  const [calculatedFee, setCalculatedFee] = useState<number | null>(null);
  
  // AI State
  const [aiBriefing, setAiBriefing] = useState<string | null>(null);
  const [isBriefing, setIsBriefing] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
  const [manualStops, setManualStops] = useState<ManualStop[]>([]);
  
  // POD State
  const [isSigning, setIsSigning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentUrl = window.location.href;

  useEffect(() => {
    if (isAuthorized && role) {
      fetchOrders();
      const interval = setInterval(fetchOrders, 300000);
      return () => clearInterval(interval);
    }
  }, [isAuthorized, role]);

  const fetchOrders = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/orders');
      if (response.ok) {
        const data = await response.json();
        // Assuming the server returns { orders: [], podData: {}, source: 'LIVE'|'MOCK' }
        // But shopifyService.getDeliveries() already handles the mapping.
        // Let's just use the service but detect if it's mock.
        const deliveries = await getDeliveries();
        setDeliveries(deliveries);
        setDataSource(deliveries.some(d => d.id === '33989') ? 'MOCK' : 'LIVE');
      } else {
        setDataSource('ERROR');
        const deliveries = await getDeliveries(); // Fallback to samples
        setDeliveries(deliveries);
      }
      setLastSyncTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      console.error("Sync Error", err);
      setDataSource('ERROR');
      const deliveries = await getDeliveries();
      setDeliveries(deliveries);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSummarize = async () => {
    if (deliveries.length === 0) return;
    setIsBriefing(true);
    const notes = deliveries.map(d => `${d.orderNumber}: ${d.deliveryInstructions || 'No instructions'}`);
    const summary = await summarizeRoute(notes);
    setAiBriefing(summary);
    setIsBriefing(false);
    
    // Auto-play speech
    const audioData = await generateSpeech(summary);
    if (audioData) {
      playRawAudio(audioData);
    }
  };

  const handleOptimize = async () => {
    setIsOptimizing(true);
    const result = await getOptimizedRoute(deliveries, manualStops, null, { skipTolls: false });
    setOptimizationResult(result);
    
    // Reorder deliveries based on optimization
    const ordered = [...deliveries].sort((a, b) => {
      const indexA = result.orderedIds.indexOf(a.id);
      const indexB = result.orderedIds.indexOf(b.id);
      return indexA - indexB;
    });
    setDeliveries(ordered);
    setIsOptimizing(false);
  };

  const handleUpdateOrder = async (id: string, updates: Partial<Delivery>) => {
    setDeliveries(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d));
    const currentOrder = deliveries.find(d => d.id === id);
    if (selectedOrder?.id === id) {
      setSelectedOrder(prev => prev ? { ...prev, ...updates } : null);
    }

    // If we are updating POD data, sync to server
    if (updates.status === DeliveryStatus.DELIVERED || updates.confirmationPhoto || updates.confirmationSignature || updates.driverNotes) {
      try {
        const fullOrder = { ...(currentOrder || {}), ...updates };
        await fetch('/api/pod', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: id,
            photo: fullOrder.confirmationPhoto,
            signature: fullOrder.confirmationSignature,
            notes: fullOrder.driverNotes,
            completedAt: fullOrder.completedAt,
            status: fullOrder.status
          })
        });
      } catch (err) {
        console.error("Failed to sync POD to server", err);
      }
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && selectedOrder) {
      const reader = new FileReader();
      reader.onloadend = () => {
        handleUpdateOrder(selectedOrder.id, { confirmationPhoto: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  const finalizeDelivery = () => {
    if (selectedOrder) {
      handleUpdateOrder(selectedOrder.id, { 
        status: DeliveryStatus.DELIVERED,
        completedAt: new Date().toISOString()
      });
    }
  };

  const handleFailedDeliveryAction = (action: 'TOMORROW' | 'CUSTOM' | 'CONTACT', customDate?: string) => {
    if (!selectedOrder) return;
    
    let note = "";
    if (action === 'TOMORROW') {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      note = `Rescheduled for tomorrow (${tomorrow.toLocaleDateString()})`;
    } else if (action === 'CUSTOM' && customDate) {
      note = `Rescheduled for ${customDate}`;
    } else if (action === 'CONTACT') {
      note = "Contacted customer for resolution";
    }

    handleUpdateOrder(selectedOrder.id, { 
      status: DeliveryStatus.FAILED,
      driverNotes: note,
      attempts: [
        ...(selectedOrder.attempts || []),
        {
          id: Date.now().toString(),
          timestamp: new Date().toISOString(),
          driverId: 'smith',
          driverName: 'Smith',
          type: 'FIRST',
          reason: 'RECIPIENT_UNAVAILABLE',
          notes: note
        }
      ]
    });
    setIsFailedMenuOpen(false);
  };

  const handleCalculateFee = () => {
    const fee = DELIVERY_FEES[feeSearchZip];
    if (fee !== undefined) {
      setCalculatedFee(fee);
    } else {
      setCalculatedFee(null);
    }
  };

  const copyAppURL = () => {
    navigator.clipboard.writeText(currentUrl);
    alert("App Link Copied! Send this to your drivers.");
  };

  const shareNative = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Sweet Tooth Driver App',
          text: 'Access the delivery portal for The Sweet Tooth.',
          url: currentUrl,
        });
      } catch (err) {
        copyAppURL();
      }
    } else {
      copyAppURL();
    }
  };

  const logout = () => {
    localStorage.removeItem('role');
    localStorage.removeItem('isAuthorized');
    setRole(null);
    setIsAuthorized(false);
    setDeliveries([]);
    setSelectedOrder(null);
    setActiveOrderId(null);
  };

  const returnToHome = () => {
    if (selectedOrder) { setSelectedOrder(null); setActiveOrderId(null); return; }
    if (tab !== 'DELIVERIES') { setTab('DELIVERIES'); return; }
  };

  const failedDeliveries = useMemo(() => {
    return deliveries.filter(d => d.status === DeliveryStatus.FAILED);
  }, [deliveries]);

  if (!isAuthorized) {
    return <LoginGate onAuthorized={(role) => {
      setRole(role);
      setIsAuthorized(true);
      localStorage.setItem('role', role);
      localStorage.setItem('isAuthorized', 'true');
    }} />;
  }

  return (
    <HashRouter>
      <div className="max-w-md mx-auto min-h-screen bg-white flex flex-col relative overflow-hidden border-x border-stone-50">
        <Header onLogout={logout} onLogoClick={returnToHome} lastSync={lastSyncTime} isSyncing={isLoading} />
        
        <main className="flex-1 overflow-y-auto pb-24">
          {tab === 'DELIVERIES' && (
            <div className="animate-in fade-in">
              <ConnectionStatus source={dataSource} lastSync={lastSyncTime} />
              
              <div className="p-6">
                <DateHeader selectedDate={new Date()} />
                
                {/* AI Route Controls */}
                <div className="grid grid-cols-2 gap-3 mt-6 mb-8">
                  <button 
                    onClick={handleSummarize}
                    disabled={isBriefing || deliveries.length === 0}
                    className="flex flex-col items-center justify-center gap-2 p-4 bg-white border border-stone-100 rounded-[24px] shadow-sm hover:bg-stone-50 transition-all active:scale-95 disabled:opacity-50"
                  >
                    <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center">
                      {isBriefing ? <RefreshCw size={20} className="animate-spin" /> : <Sparkles size={20} />}
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-tight">AI Briefing</span>
                  </button>
                  
                  <button 
                    onClick={handleOptimize}
                    disabled={isOptimizing || deliveries.length === 0}
                    className="flex flex-col items-center justify-center gap-2 p-4 bg-white border border-stone-100 rounded-[24px] shadow-sm hover:bg-stone-50 transition-all active:scale-95 disabled:opacity-50"
                  >
                    <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center">
                      {isOptimizing ? <RefreshCw size={20} className="animate-spin" /> : <Zap size={20} />}
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-tight">Optimize Route</span>
                  </button>
                </div>

                {aiBriefing && (
                  <div className="mb-8 p-5 bg-indigo-600 text-white rounded-[32px] shadow-lg animate-in slide-in-from-top-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Sparkles size={16} />
                        <span className="text-[10px] font-black uppercase tracking-widest">Route Summary</span>
                      </div>
                      <button onClick={() => setAiBriefing(null)} className="text-white/60 hover:text-white">
                        <X size={16} />
                      </button>
                    </div>
                    <p className="text-sm font-medium leading-relaxed italic">"{aiBriefing}"</p>
                    <div className="mt-4 flex items-center gap-2">
                      <button 
                        onClick={() => generateSpeech(aiBriefing).then(data => data && playRawAudio(data))}
                        className="flex items-center gap-2 px-3 py-1.5 bg-white/20 rounded-full text-[9px] font-black uppercase hover:bg-white/30 transition-colors"
                      >
                        <Volume2 size={12} />
                        Play Audio
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-black text-black tracking-tighter uppercase">Local Routes</h2>
                    <div className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-pink-500"></span>
                    </div>
                  </div>
                  <button onClick={fetchOrders} className={`${isLoading ? 'animate-spin' : ''} text-stone-300`}>
                    <RefreshCw size={18} />
                  </button>
                </div>

                <div className="bg-white border border-stone-100 rounded-[32px] overflow-hidden shadow-sm">
                  {deliveries.map(d => (
                    <OrderRow 
                      key={d.id} 
                      order={d} 
                      isSelected={activeOrderId === d.id}
                      onSelect={() => setActiveOrderId(d.id)}
                      onView={() => setSelectedOrder(d)}
                    />
                  ))}
                  {deliveries.length === 0 && (
                    <div className="py-24 text-center">
                      <Package size={32} className="mx-auto text-stone-100 mb-2" />
                      <p className="text-[10px] font-black uppercase text-stone-300">Searching for Orders...</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'CHAT' && <ChatView role={role!} />}
          
          {tab === 'ADMIN' && (
            <div className="p-6 space-y-8 animate-in fade-in">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-black text-black tracking-tighter uppercase">Admin</h2>
                <div className="px-3 py-1 bg-green-50 text-green-600 rounded-full text-[8px] font-black uppercase flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                  Active System
                </div>
              </div>
              
              {role === 'ADMIN' && (
                <section className="space-y-6">
                   {/* Delivery Fees View */}
                   <div className="p-6 bg-white border border-stone-100 rounded-[32px] shadow-sm space-y-6">
                      <div className="flex items-center gap-2">
                        <FileText size={20} className="text-pink-500" />
                        <h3 className="text-lg font-black uppercase tracking-tighter">Delivery Fees</h3>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[8px] font-black uppercase text-stone-400 mb-1 block">Start Date</label>
                          <input 
                            type="date" 
                            value={feeStartDate}
                            onChange={(e) => setFeeStartDate(e.target.value)}
                            className="w-full bg-stone-50 border border-stone-100 rounded-xl px-3 py-2 text-[10px] font-black outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-[8px] font-black uppercase text-stone-400 mb-1 block">End Date</label>
                          <input 
                            type="date" 
                            value={feeEndDate}
                            onChange={(e) => setFeeEndDate(e.target.value)}
                            className="w-full bg-stone-50 border border-stone-100 rounded-xl px-3 py-2 text-[10px] font-black outline-none"
                          />
                        </div>
                      </div>

                      <div className="pt-4 border-t border-stone-50 flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase text-stone-400">Total Fees</span>
                        <span className="text-2xl font-black text-black">
                          ${deliveries
                            .filter(d => d.status === DeliveryStatus.DELIVERED)
                            .filter(d => {
                              if (!d.completedAt) return false;
                              const date = d.completedAt.split('T')[0];
                              return date >= feeStartDate && date <= feeEndDate;
                            })
                            .reduce((sum, d) => sum + (d.deliveryFee || 0), 0)
                            .toFixed(2)}
                        </span>
                      </div>
                   </div>

                   {/* Fee Calculator */}
                   <div className="p-6 bg-stone-50 rounded-[32px] border border-stone-100 space-y-4">
                      <div className="flex items-center gap-2">
                        <MapPin size={20} className="text-blue-500" />
                        <h3 className="text-lg font-black uppercase tracking-tighter">Fee Calculator</h3>
                      </div>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          placeholder="Enter Zip Code"
                          value={feeSearchZip}
                          onChange={(e) => setFeeSearchZip(e.target.value)}
                          className="flex-1 bg-white border border-stone-100 rounded-xl px-4 py-3 text-xs font-black outline-none focus:border-black transition-all"
                        />
                        <button 
                          onClick={handleCalculateFee}
                          className="px-6 bg-black text-white rounded-xl font-black uppercase text-[10px] active:scale-95 transition-all"
                        >
                          Calculate
                        </button>
                      </div>
                      {calculatedFee !== null ? (
                        <div className="p-4 bg-white rounded-2xl border border-blue-100 animate-in zoom-in-95">
                          <p className="text-[8px] font-black uppercase text-stone-400 mb-1">Estimated Delivery Fee</p>
                          <p className="text-xl font-black text-blue-600">${calculatedFee.toFixed(2)}</p>
                        </div>
                      ) : feeSearchZip && (
                        <p className="text-[8px] font-black uppercase text-stone-300 italic">Zip code not in list. Standard rate: ${PER_MILE_RATE}/mile</p>
                      )}
                   </div>

                   {/* Failed Delivery Report */}
                   {failedDeliveries.length > 0 && (
                     <div className="space-y-4">
                        <div className="flex items-center gap-2">
                           <AlertCircle className="text-red-500" size={20} />
                           <h3 className="text-lg font-black uppercase tracking-tighter">Failed Delivery Report</h3>
                        </div>
                        <div className="space-y-3">
                           {failedDeliveries.map(d => {
                             const lastAttempt = d.attempts?.[d.attempts.length - 1];
                             return (
                               <div key={d.id} onClick={() => setSelectedOrder(d)} className="p-5 bg-red-50/50 border border-red-100 rounded-[32px] cursor-pointer hover:bg-red-50 transition-colors">
                                  <div className="flex justify-between items-start mb-3">
                                     <div>
                                        <p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-1">{d.orderNumber}</p>
                                        <h4 className="text-sm font-black text-stone-900">{d.customer.name}</h4>
                                     </div>
                                     <div className="px-2 py-0.5 bg-red-500 text-white rounded-full text-[8px] font-black uppercase">FAILED</div>
                                  </div>
                                  <div className="space-y-2">
                                     <div className="flex items-center gap-2">
                                        <AlertTriangle size={12} className="text-red-400" />
                                        <p className="text-[10px] font-bold text-red-600 uppercase">Reason: {lastAttempt?.reason || 'OTHER'}</p>
                                     </div>
                                     { (d.driverNotes || lastAttempt?.notes) && (
                                       <div className="p-3 bg-white/60 rounded-2xl border border-red-50">
                                          <div className="flex items-center gap-1.5 mb-1">
                                             <FileText size={10} className="text-stone-400" />
                                              <span className="text-[8px] font-black text-stone-400 uppercase">Driver Notes</span>
                                          </div>
                                          <p className="text-[11px] text-stone-600 italic leading-relaxed">
                                             "{d.driverNotes || lastAttempt?.notes}"
                                          </p>
                                       </div>
                                     )}
                                  </div>
                               </div>
                             );
                           })}
                        </div>
                     </div>
                   )}

                   {/* Quick Info Cards */}
                   <div className="grid grid-cols-2 gap-3">
                      <div className="p-5 bg-white border border-stone-100 rounded-[28px] shadow-sm">
                        <Key size={20} className="text-pink-500 mb-3" />
                        <p className="text-[8px] font-black uppercase text-stone-400 mb-1">Access Passcode</p>
                        <p className="text-sm font-black tracking-widest">{ACCESS_PASSCODE}</p>
                      </div>
                      <div className="p-5 bg-white border border-stone-100 rounded-[28px] shadow-sm">
                        <Globe size={20} className="text-blue-500 mb-3" />
                        <p className="text-[8px] font-black uppercase text-stone-400 mb-1">Shopify Hook</p>
                        <p className="text-sm font-black text-green-600">Active</p>
                      </div>
                   </div>
                </section>
              )}

              <section className="space-y-4">
                 <div className="p-6 bg-stone-50 rounded-[32px] border border-stone-100">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="p-3 bg-white rounded-2xl shadow-sm"><Smartphone size={24} className="text-stone-900" /></div>
                      <div>
                        <h4 className="text-sm font-black uppercase">Mobile Experience</h4>
                        <p className="text-[10px] text-stone-400 font-bold uppercase tracking-tight">Optimized for iOS & Android</p>
                      </div>
                    </div>
                    <p className="text-[11px] text-stone-500 font-medium leading-relaxed mb-4">
                      This app is a <span className="font-black text-black">Progressive Web App (PWA)</span>. 
                      Once you visit the URL on a phone, tap your browser's menu and select <strong>"Add to Home Screen"</strong>. 
                      This removes the browser bars and provides an app-like experience for your drivers.
                    </p>
                    <div className="flex gap-2">
                       <span className="px-3 py-1 bg-white border border-stone-100 rounded-full text-[8px] font-black text-stone-400 uppercase">Offline Ready</span>
                       <span className="px-3 py-1 bg-white border border-stone-100 rounded-full text-[8px] font-black text-stone-400 uppercase">Native Navigation</span>
                    </div>
                 </div>

                 <div className="p-6 bg-white border border-stone-100 rounded-[32px] shadow-sm flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-blue-50 text-blue-500 rounded-2xl"><Zap size={20} /></div>
                      <div>
                        <p className="text-[10px] font-black uppercase text-stone-400">Current Build</p>
                        <p className="text-xs font-black">v1.1.0 (STABLE)</p>
                      </div>
                    </div>
                    <p className="text-[8px] font-black text-stone-300 uppercase">Sweet Tooth</p>
                 </div>
              </section>

              <div className="pt-4 text-center">
                 <button onClick={logout} className="text-[10px] font-black uppercase tracking-widest text-red-400 hover:text-red-500">
                    Disconnect Session
                 </button>
              </div>
            </div>
          )}
        </main>

        <nav className="fixed bottom-0 left-0 right-0 h-24 bg-white border-t border-stone-50 flex items-center justify-around z-[110] max-w-md mx-auto px-6 shadow-lg">
          <button onClick={() => setTab('DELIVERIES')} className={`flex flex-col items-center gap-1 transition-all ${tab === 'DELIVERIES' ? 'text-black scale-110' : 'text-stone-300'}`}>
            <Package size={22} strokeWidth={tab === 'DELIVERIES' ? 3 : 2} />
            <span className="text-[8px] font-black uppercase">Routes</span>
          </button>
          <button onClick={() => setTab('CHAT')} className={`flex flex-col items-center gap-1 transition-all ${tab === 'CHAT' ? 'text-black scale-110' : 'text-stone-300'}`}>
            <MessageSquare size={22} strokeWidth={tab === 'CHAT' ? 3 : 2} />
            <span className="text-[8px] font-black uppercase">Chat</span>
          </button>
          <button onClick={() => setTab('ADMIN')} className={`flex flex-col items-center gap-1 transition-all ${tab === 'ADMIN' ? 'text-black scale-110' : 'text-stone-300'}`}>
            <Truck size={22} strokeWidth={tab === 'ADMIN' ? 3 : 2} />
            <span className="text-[8px] font-black uppercase">Admin</span>
          </button>
        </nav>

        {selectedOrder && (
          <div className="fixed inset-0 bg-white z-[200] flex flex-col animate-in slide-in-from-right">
            <div className="p-6 border-b border-stone-100 flex items-center justify-between">
              <button onClick={() => {setSelectedOrder(null); setActiveOrderId(null);}} className="p-2 -ml-2 hover:bg-stone-50 rounded-full"><X size={24} /></button>
              <h2 className="font-black uppercase tracking-widest text-[10px] text-stone-400">{selectedOrder.orderNumber}</h2>
              <div className="w-10"></div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
               <section className="space-y-4">
                 <div className="flex justify-between items-start">
                   <div>
                     <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-1">Recipient</p>
                     <h3 className="text-3xl font-black text-stone-900 tracking-tighter">{selectedOrder.customer.name}</h3>
                   </div>
                   {selectedOrder.status === DeliveryStatus.DELIVERED && (
                     <span className="bg-black text-white px-3 py-1 rounded-full text-[9px] font-black uppercase">Completed</span>
                   )}
                   {selectedOrder.status === DeliveryStatus.FAILED && (
                     <span className="bg-red-500 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase">Failed</span>
                   )}
                 </div>

                 {selectedOrder.deliveryInstructions && (
                   <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl">
                     <div className="flex items-center gap-2 mb-1">
                       <Info size={14} className="text-amber-600" />
                       <span className="text-[10px] font-black uppercase text-amber-600">Delivery Instructions</span>
                     </div>
                     <p className="text-xs font-bold text-amber-900 leading-relaxed">{selectedOrder.deliveryInstructions}</p>
                   </div>
                 )}
                 
                 <div className="flex gap-2">
                    <a href={`tel:${selectedOrder.customer.phone}`} className="flex-1 py-3 bg-stone-100 rounded-2xl flex items-center justify-center gap-2 text-[10px] font-black uppercase hover:bg-stone-200 transition-all">
                      <Phone size={14} /> Call Recipient
                    </a>
                    <button 
                      onClick={async () => {
                        const msg = await generateCustomerSMS(selectedOrder.customer.name, selectedOrder.orderNumber);
                        window.location.href = `sms:${selectedOrder.customer.phone}?body=${encodeURIComponent(msg)}`;
                      }}
                      className="flex-1 py-3 bg-stone-100 rounded-2xl flex items-center justify-center gap-2 text-[10px] font-black uppercase hover:bg-stone-200 transition-all"
                    >
                      <Sparkles size={14} className="text-indigo-500" /> AI SMS
                    </button>
                    <a href={`sms:${selectedOrder.customer.phone}`} className="flex-1 py-3 bg-stone-100 rounded-2xl flex items-center justify-center gap-2 text-[10px] font-black uppercase hover:bg-stone-200 transition-all">
                      <MessageSquare size={14} /> Text Recipient
                    </a>
                 </div>
               </section>

               {selectedOrder.giftSenderName && (
                 <section className="p-5 bg-pink-50/30 rounded-[32px] border border-pink-100/50 space-y-3">
                    <div>
                      <p className="text-[10px] font-black text-pink-400 uppercase tracking-widest mb-1">Gift Giver (Buyer)</p>
                      <h4 className="text-lg font-black text-stone-900">{selectedOrder.giftSenderName}</h4>
                    </div>
                    {selectedOrder.giftMessage && (
                      <div className="p-3 bg-white/60 rounded-2xl border border-pink-50 relative group">
                        <p className="text-[11px] text-stone-600 italic">"{selectedOrder.giftMessage}"</p>
                        <button 
                          onClick={() => generateSpeech(selectedOrder.giftMessage!).then(data => data && playRawAudio(data))}
                          className="absolute right-2 top-2 p-1.5 bg-pink-100 text-pink-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Volume2 size={12} />
                        </button>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <a href={`tel:${selectedOrder.giftSenderPhone || selectedOrder.customer.phone}`} className="flex-1 py-3 bg-white rounded-xl flex items-center justify-center gap-2 text-[9px] font-black uppercase border border-pink-100">
                        <Phone size={12} /> Call Giver
                      </a>
                      <a href={`sms:${selectedOrder.giftSenderPhone || selectedOrder.customer.phone}`} className="flex-1 py-3 bg-white rounded-xl flex items-center justify-center gap-2 text-[9px] font-black uppercase border border-pink-100">
                        <MessageSquare size={12} /> Text Giver
                      </a>
                    </div>
                 </section>
               )}

               <section className="p-5 bg-stone-50 rounded-[32px] border border-stone-100">
                 <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-2">Location</p>
                 <p className="text-sm font-black text-stone-900">{selectedOrder.address.street}, {selectedOrder.address.city}</p>
                 {selectedOrder.status !== DeliveryStatus.DELIVERED && selectedOrder.status !== DeliveryStatus.FAILED && (
                   <button 
                    onClick={() => {
                      handleUpdateOrder(selectedOrder.id, { status: DeliveryStatus.IN_TRANSIT });
                      window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selectedOrder.address.street)}`);
                    }}
                    className="mt-4 w-full py-4 bg-black text-white rounded-2xl flex items-center justify-center gap-3 font-black uppercase text-[10px] active:scale-95 transition-all shadow-md"
                   >
                     <Navigation size={16} /> Start Navigation
                   </button>
                 )}
               </section>

               {selectedOrder.status !== DeliveryStatus.DELIVERED && selectedOrder.status !== DeliveryStatus.FAILED && (
                 <section className="space-y-4">
                   <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest">Proof of Delivery</p>
                   
                   <div className="grid grid-cols-2 gap-3">
                     <button 
                        onClick={() => fileInputRef.current?.click()}
                        className={`aspect-square rounded-[32px] border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-all ${selectedOrder.confirmationPhoto ? 'border-black bg-stone-50' : 'border-stone-200 hover:border-black'}`}
                      >
                       <input type="file" hidden ref={fileInputRef} accept="image/*" capture="environment" onChange={handlePhotoUpload} />
                       {selectedOrder.confirmationPhoto ? (
                         <img src={selectedOrder.confirmationPhoto} className="w-full h-full object-cover rounded-[28px]" />
                       ) : (
                         <>
                           <Camera size={24} className="text-stone-400" />
                           <span className="text-[8px] font-black uppercase">Take Photo</span>
                         </>
                       )}
                     </button>

                     <button 
                        onClick={() => setIsSigning(true)}
                        className={`aspect-square rounded-[32px] border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-all ${selectedOrder.confirmationSignature ? 'border-black bg-stone-50' : 'border-stone-200 hover:border-black'}`}
                      >
                       {selectedOrder.confirmationSignature ? (
                         <img src={selectedOrder.confirmationSignature} className="w-full h-full object-contain p-4" />
                       ) : (
                         <>
                           <PenTool size={24} className="text-stone-400" />
                           <span className="text-[8px] font-black uppercase">Get Signature</span>
                         </>
                       )}
                     </button>
                   </div>

                   {selectedOrder.confirmationPhoto && selectedOrder.confirmationSignature && (
                     <button 
                        onClick={finalizeDelivery}
                        className="w-full py-6 bg-[#FDF0F6] text-black border-2 border-black rounded-[32px] font-black uppercase tracking-widest shadow-xl flex items-center justify-center gap-3 animate-in zoom-in-95"
                      >
                       <CheckCircle2 size={20} /> Complete Delivery
                     </button>
                   )}
                 </section>
               )}

               {selectedOrder.status === DeliveryStatus.DELIVERED && (
                 <div className="space-y-6">
                    <section className="p-6 bg-stone-50 rounded-[32px] border border-stone-100 space-y-4 animate-in fade-in">
                        <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest">Completion Records</p>
                        <div className="flex gap-4">
                        {selectedOrder.confirmationPhoto && (
                            <div className="flex-1">
                            <p className="text-[8px] font-black uppercase text-stone-300 mb-2">Photo</p>
                            <img src={selectedOrder.confirmationPhoto} className="w-full aspect-square object-cover rounded-xl" />
                            </div>
                        )}
                        {selectedOrder.confirmationSignature && (
                            <div className="flex-1">
                            <p className="text-[8px] font-black uppercase text-stone-300 mb-2">Signature</p>
                            <img src={selectedOrder.confirmationSignature} className="w-full aspect-square object-contain bg-white rounded-xl p-2 border border-stone-100" />
                            </div>
                        )}
                        </div>
                        <div className="pt-2 border-t border-stone-100">
                        <p className="text-[10px] font-black text-stone-900">Delivered at {selectedOrder.completedAt}</p>
                        </div>
                    </section>

                    <section className="p-6 bg-black text-white rounded-[32px] shadow-lg space-y-4">
                        <div className="flex items-center gap-3 mb-2">
                            <Share2 size={18} className="text-pink-400" />
                            <h4 className="text-sm font-black uppercase tracking-tighter">Share Proof of Delivery</h4>
                        </div>
                        <p className="text-[10px] text-white/50 font-bold leading-relaxed mb-4">
                            Send delivery details, photos, and signatures directly to the customer or business recipient.
                        </p>
                        <button 
                          onClick={() => setIsSharingPod(true)}
                          className="w-full py-5 bg-white text-black rounded-2xl font-black uppercase text-[10px] flex items-center justify-center gap-2 active:scale-95 transition-all"
                        >
                            <Send size={14} /> Send Confirmation
                        </button>
                    </section>
                 </div>
               )}

               {selectedOrder.status === DeliveryStatus.FAILED && (
                 <section className="p-6 bg-red-50 rounded-[32px] border border-red-100 space-y-4 animate-in fade-in">
                    <p className="text-[10px] font-black text-red-400 uppercase tracking-widest">Failure Incident Report</p>
                    <div className="space-y-3">
                       <div>
                          <p className="text-[8px] font-black uppercase text-stone-400 mb-1">Reason Code</p>
                          <p className="text-sm font-black text-red-600">{selectedOrder.attempts?.[selectedOrder.attempts.length - 1]?.reason || 'OTHER'}</p>
                       </div>
                       {selectedOrder.driverNotes && (
                         <div>
                            <p className="text-[8px] font-black uppercase text-stone-400 mb-1">Driver Explanation</p>
                            <p className="text-[11px] text-stone-600 italic leading-relaxed">"{selectedOrder.driverNotes}"</p>
                         </div>
                       )}
                    </div>
                 </section>
               )}

               <section className="grid grid-cols-2 gap-2">
                  <a href={`tel:${selectedOrder.customer.phone}`} className="py-4 bg-stone-100 text-black rounded-2xl flex items-center justify-center gap-2 font-black uppercase text-[10px] active:bg-stone-200 transition-colors">
                    <Phone size={14} /> Call
                  </a>
                  <a href={`sms:${selectedOrder.customer.phone}`} className="py-4 bg-stone-100 text-black rounded-2xl flex items-center justify-center gap-2 font-black uppercase text-[10px] active:bg-stone-200 transition-colors">
                    <MessageCircle size={14} /> Text
                  </a>
               </section>
            </div>

            {isSigning && (
              <SignaturePad 
                onSave={(sig) => {
                  handleUpdateOrder(selectedOrder.id, { confirmationSignature: sig });
                  setIsSigning(false);
                }} 
                onCancel={() => setIsSigning(false)} 
              />
            )}

            {isSharingPod && (
              <SharePodModal 
                order={selectedOrder} 
                onClose={() => setIsSharingPod(false)} 
              />
            )}

            {isFailedMenuOpen && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-end animate-in fade-in">
                <div className="w-full bg-white rounded-t-[40px] p-8 space-y-6 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Delivery Failed</h3>
                    <button onClick={() => setIsFailedMenuOpen(false)} className="p-2 text-stone-300"><X size={24} /></button>
                  </div>
                  <p className="text-xs text-stone-500 font-medium">Select an action to resolve this delivery issue:</p>
                  <div className="space-y-3">
                    <button 
                      onClick={() => handleFailedDeliveryAction('TOMORROW')}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Reschedule for Tomorrow
                    </button>
                    <button 
                      onClick={() => {
                        const date = prompt("Enter custom date (e.g. MM/DD/YYYY):");
                        if (date) handleFailedDeliveryAction('CUSTOM', date);
                      }}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Input Custom Date
                    </button>
                    <button 
                      onClick={() => {
                        setIsFailedMenuOpen(false);
                        window.location.href = `tel:${selectedOrder.customer.phone}`;
                      }}
                      className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Phone size={18} /> Contact Customer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isFailedMenuOpen && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-end animate-in fade-in">
                <div className="w-full bg-white rounded-t-[40px] p-8 space-y-6 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Delivery Failed</h3>
                    <button onClick={() => setIsFailedMenuOpen(false)} className="p-2 text-stone-300"><X size={24} /></button>
                  </div>
                  <p className="text-xs text-stone-500 font-medium">Select an action to resolve this delivery issue:</p>
                  <div className="space-y-3">
                    <button 
                      onClick={() => handleFailedDeliveryAction('TOMORROW')}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Reschedule for Tomorrow
                    </button>
                    <button 
                      onClick={() => {
                        const date = prompt("Enter custom date (e.g. MM/DD/YYYY):");
                        if (date) handleFailedDeliveryAction('CUSTOM', date);
                      }}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Input Custom Date
                    </button>
                    <button 
                      onClick={() => {
                        setIsFailedMenuOpen(false);
                        window.location.href = `tel:${selectedOrder.customer.phone}`;
                      }}
                      className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Phone size={18} /> Contact Customer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isFailedMenuOpen && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-end animate-in fade-in">
                <div className="w-full bg-white rounded-t-[40px] p-8 space-y-6 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Delivery Failed</h3>
                    <button onClick={() => setIsFailedMenuOpen(false)} className="p-2 text-stone-300"><X size={24} /></button>
                  </div>
                  <p className="text-xs text-stone-500 font-medium">Select an action to resolve this delivery issue:</p>
                  <div className="space-y-3">
                    <button 
                      onClick={() => handleFailedDeliveryAction('TOMORROW')}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Reschedule for Tomorrow
                    </button>
                    <button 
                      onClick={() => {
                        const date = prompt("Enter custom date (e.g. MM/DD/YYYY):");
                        if (date) handleFailedDeliveryAction('CUSTOM', date);
                      }}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Input Custom Date
                    </button>
                    <button 
                      onClick={() => {
                        setIsFailedMenuOpen(false);
                        window.location.href = `tel:${selectedOrder.customer.phone}`;
                      }}
                      className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Phone size={18} /> Contact Customer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isFailedMenuOpen && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-end animate-in fade-in">
                <div className="w-full bg-white rounded-t-[40px] p-8 space-y-6 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Delivery Failed</h3>
                    <button onClick={() => setIsFailedMenuOpen(false)} className="p-2 text-stone-300"><X size={24} /></button>
                  </div>
                  <p className="text-xs text-stone-500 font-medium">Select an action to resolve this delivery issue:</p>
                  <div className="space-y-3">
                    <button 
                      onClick={() => handleFailedDeliveryAction('TOMORROW')}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Reschedule for Tomorrow
                    </button>
                    <button 
                      onClick={() => {
                        const date = prompt("Enter custom date (e.g. MM/DD/YYYY):");
                        if (date) handleFailedDeliveryAction('CUSTOM', date);
                      }}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Input Custom Date
                    </button>
                    <button 
                      onClick={() => {
                        setIsFailedMenuOpen(false);
                        window.location.href = `tel:${selectedOrder.customer.phone}`;
                      }}
                      className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Phone size={18} /> Contact Customer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isFailedMenuOpen && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-end animate-in fade-in">
                <div className="w-full bg-white rounded-t-[40px] p-8 space-y-6 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Delivery Failed</h3>
                    <button onClick={() => setIsFailedMenuOpen(false)} className="p-2 text-stone-300"><X size={24} /></button>
                  </div>
                  <p className="text-xs text-stone-500 font-medium">Select an action to resolve this delivery issue:</p>
                  <div className="space-y-3">
                    <button 
                      onClick={() => handleFailedDeliveryAction('TOMORROW')}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Reschedule for Tomorrow
                    </button>
                    <button 
                      onClick={() => {
                        const date = prompt("Enter custom date (e.g. MM/DD/YYYY):");
                        if (date) handleFailedDeliveryAction('CUSTOM', date);
                      }}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Input Custom Date
                    </button>
                    <button 
                      onClick={() => {
                        setIsFailedMenuOpen(false);
                        window.location.href = `tel:${selectedOrder.customer.phone}`;
                      }}
                      className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Phone size={18} /> Contact Customer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isFailedMenuOpen && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-end animate-in fade-in">
                <div className="w-full bg-white rounded-t-[40px] p-8 space-y-6 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Delivery Failed</h3>
                    <button onClick={() => setIsFailedMenuOpen(false)} className="p-2 text-stone-300"><X size={24} /></button>
                  </div>
                  <p className="text-xs text-stone-500 font-medium">Select an action to resolve this delivery issue:</p>
                  <div className="space-y-3">
                    <button 
                      onClick={() => handleFailedDeliveryAction('TOMORROW')}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Reschedule for Tomorrow
                    </button>
                    <button 
                      onClick={() => {
                        const date = prompt("Enter custom date (e.g. MM/DD/YYYY):");
                        if (date) handleFailedDeliveryAction('CUSTOM', date);
                      }}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Input Custom Date
                    </button>
                    <button 
                      onClick={() => {
                        setIsFailedMenuOpen(false);
                        window.location.href = `tel:${selectedOrder.customer.phone}`;
                      }}
                      className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Phone size={18} /> Contact Customer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isFailedMenuOpen && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-end animate-in fade-in">
                <div className="w-full bg-white rounded-t-[40px] p-8 space-y-6 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Delivery Failed</h3>
                    <button onClick={() => setIsFailedMenuOpen(false)} className="p-2 text-stone-300"><X size={24} /></button>
                  </div>
                  <p className="text-xs text-stone-500 font-medium">Select an action to resolve this delivery issue:</p>
                  <div className="space-y-3">
                    <button 
                      onClick={() => handleFailedDeliveryAction('TOMORROW')}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Reschedule for Tomorrow
                    </button>
                    <button 
                      onClick={() => {
                        const date = prompt("Enter custom date (e.g. MM/DD/YYYY):");
                        if (date) handleFailedDeliveryAction('CUSTOM', date);
                      }}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Input Custom Date
                    </button>
                    <button 
                      onClick={() => {
                        setIsFailedMenuOpen(false);
                        window.location.href = `tel:${selectedOrder.customer.phone}`;
                      }}
                      className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Phone size={18} /> Contact Customer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isFailedMenuOpen && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-end animate-in fade-in">
                <div className="w-full bg-white rounded-t-[40px] p-8 space-y-6 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Delivery Failed</h3>
                    <button onClick={() => setIsFailedMenuOpen(false)} className="p-2 text-stone-300"><X size={24} /></button>
                  </div>
                  <p className="text-xs text-stone-500 font-medium">Select an action to resolve this delivery issue:</p>
                  <div className="space-y-3">
                    <button 
                      onClick={() => handleFailedDeliveryAction('TOMORROW')}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Reschedule for Tomorrow
                    </button>
                    <button 
                      onClick={() => {
                        const date = prompt("Enter custom date (e.g. MM/DD/YYYY):");
                        if (date) handleFailedDeliveryAction('CUSTOM', date);
                      }}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Input Custom Date
                    </button>
                    <button 
                      onClick={() => {
                        setIsFailedMenuOpen(false);
                        window.location.href = `tel:${selectedOrder.customer.phone}`;
                      }}
                      className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Phone size={18} /> Contact Customer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isFailedMenuOpen && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-end animate-in fade-in">
                <div className="w-full bg-white rounded-t-[40px] p-8 space-y-6 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Delivery Failed</h3>
                    <button onClick={() => setIsFailedMenuOpen(false)} className="p-2 text-stone-300"><X size={24} /></button>
                  </div>
                  <p className="text-xs text-stone-500 font-medium">Select an action to resolve this delivery issue:</p>
                  <div className="space-y-3">
                    <button 
                      onClick={() => handleFailedDeliveryAction('TOMORROW')}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Reschedule for Tomorrow
                    </button>
                    <button 
                      onClick={() => {
                        const date = prompt("Enter custom date (e.g. MM/DD/YYYY):");
                        if (date) handleFailedDeliveryAction('CUSTOM', date);
                      }}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Input Custom Date
                    </button>
                    <button 
                      onClick={() => {
                        setIsFailedMenuOpen(false);
                        window.location.href = `tel:${selectedOrder.customer.phone}`;
                      }}
                      className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Phone size={18} /> Contact Customer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isFailedMenuOpen && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-end animate-in fade-in">
                <div className="w-full bg-white rounded-t-[40px] p-8 space-y-6 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Delivery Failed</h3>
                    <button onClick={() => setIsFailedMenuOpen(false)} className="p-2 text-stone-300"><X size={24} /></button>
                  </div>
                  <p className="text-xs text-stone-500 font-medium">Select an action to resolve this delivery issue:</p>
                  <div className="space-y-3">
                    <button 
                      onClick={() => handleFailedDeliveryAction('TOMORROW')}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Reschedule for Tomorrow
                    </button>
                    <button 
                      onClick={() => {
                        const date = prompt("Enter custom date (e.g. MM/DD/YYYY):");
                        if (date) handleFailedDeliveryAction('CUSTOM', date);
                      }}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Input Custom Date
                    </button>
                    <button 
                      onClick={() => {
                        setIsFailedMenuOpen(false);
                        window.location.href = `tel:${selectedOrder.customer.phone}`;
                      }}
                      className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Phone size={18} /> Contact Customer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isFailedMenuOpen && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-end animate-in fade-in">
                <div className="w-full bg-white rounded-t-[40px] p-8 space-y-6 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Delivery Failed</h3>
                    <button onClick={() => setIsFailedMenuOpen(false)} className="p-2 text-stone-300"><X size={24} /></button>
                  </div>
                  <p className="text-xs text-stone-500 font-medium">Select an action to resolve this delivery issue:</p>
                  <div className="space-y-3">
                    <button 
                      onClick={() => handleFailedDeliveryAction('TOMORROW')}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Reschedule for Tomorrow
                    </button>
                    <button 
                      onClick={() => {
                        const date = prompt("Enter custom date (e.g. MM/DD/YYYY):");
                        if (date) handleFailedDeliveryAction('CUSTOM', date);
                      }}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Input Custom Date
                    </button>
                    <button 
                      onClick={() => {
                        setIsFailedMenuOpen(false);
                        window.location.href = `tel:${selectedOrder.customer.phone}`;
                      }}
                      className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Phone size={18} /> Contact Customer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isFailedMenuOpen && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-end animate-in fade-in">
                <div className="w-full bg-white rounded-t-[40px] p-8 space-y-6 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Delivery Failed</h3>
                    <button onClick={() => setIsFailedMenuOpen(false)} className="p-2 text-stone-300"><X size={24} /></button>
                  </div>
                  <p className="text-xs text-stone-500 font-medium">Select an action to resolve this delivery issue:</p>
                  <div className="space-y-3">
                    <button 
                      onClick={() => handleFailedDeliveryAction('TOMORROW')}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Reschedule for Tomorrow
                    </button>
                    <button 
                      onClick={() => {
                        const date = prompt("Enter custom date (e.g. MM/DD/YYYY):");
                        if (date) handleFailedDeliveryAction('CUSTOM', date);
                      }}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Input Custom Date
                    </button>
                    <button 
                      onClick={() => {
                        setIsFailedMenuOpen(false);
                        window.location.href = `tel:${selectedOrder.customer.phone}`;
                      }}
                      className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Phone size={18} /> Contact Customer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isFailedMenuOpen && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-end animate-in fade-in">
                <div className="w-full bg-white rounded-t-[40px] p-8 space-y-6 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Delivery Failed</h3>
                    <button onClick={() => setIsFailedMenuOpen(false)} className="p-2 text-stone-300"><X size={24} /></button>
                  </div>
                  <p className="text-xs text-stone-500 font-medium">Select an action to resolve this delivery issue:</p>
                  <div className="space-y-3">
                    <button 
                      onClick={() => handleFailedDeliveryAction('TOMORROW')}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Reschedule for Tomorrow
                    </button>
                    <button 
                      onClick={() => {
                        const date = prompt("Enter custom date (e.g. MM/DD/YYYY):");
                        if (date) handleFailedDeliveryAction('CUSTOM', date);
                      }}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Input Custom Date
                    </button>
                    <button 
                      onClick={() => {
                        setIsFailedMenuOpen(false);
                        window.location.href = `tel:${selectedOrder.customer.phone}`;
                      }}
                      className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Phone size={18} /> Contact Customer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isFailedMenuOpen && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-end animate-in fade-in">
                <div className="w-full bg-white rounded-t-[40px] p-8 space-y-6 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Delivery Failed</h3>
                    <button onClick={() => setIsFailedMenuOpen(false)} className="p-2 text-stone-300"><X size={24} /></button>
                  </div>
                  <p className="text-xs text-stone-500 font-medium">Select an action to resolve this delivery issue:</p>
                  <div className="space-y-3">
                    <button 
                      onClick={() => handleFailedDeliveryAction('TOMORROW')}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Reschedule for Tomorrow
                    </button>
                    <button 
                      onClick={() => {
                        const date = prompt("Enter custom date (e.g. MM/DD/YYYY):");
                        if (date) handleFailedDeliveryAction('CUSTOM', date);
                      }}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Input Custom Date
                    </button>
                    <button 
                      onClick={() => {
                        setIsFailedMenuOpen(false);
                        window.location.href = `tel:${selectedOrder.customer.phone}`;
                      }}
                      className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Phone size={18} /> Contact Customer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isFailedMenuOpen && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-end animate-in fade-in">
                <div className="w-full bg-white rounded-t-[40px] p-8 space-y-6 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Delivery Failed</h3>
                    <button onClick={() => setIsFailedMenuOpen(false)} className="p-2 text-stone-300"><X size={24} /></button>
                  </div>
                  <p className="text-xs text-stone-500 font-medium">Select an action to resolve this delivery issue:</p>
                  <div className="space-y-3">
                    <button 
                      onClick={() => handleFailedDeliveryAction('TOMORROW')}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Reschedule for Tomorrow
                    </button>
                    <button 
                      onClick={() => {
                        const date = prompt("Enter custom date (e.g. MM/DD/YYYY):");
                        if (date) handleFailedDeliveryAction('CUSTOM', date);
                      }}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Input Custom Date
                    </button>
                    <button 
                      onClick={() => {
                        setIsFailedMenuOpen(false);
                        window.location.href = `tel:${selectedOrder.customer.phone}`;
                      }}
                      className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Phone size={18} /> Contact Customer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isFailedMenuOpen && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-end animate-in fade-in">
                <div className="w-full bg-white rounded-t-[40px] p-8 space-y-6 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Delivery Failed</h3>
                    <button onClick={() => setIsFailedMenuOpen(false)} className="p-2 text-stone-300"><X size={24} /></button>
                  </div>
                  <p className="text-xs text-stone-500 font-medium">Select an action to resolve this delivery issue:</p>
                  <div className="space-y-3">
                    <button 
                      onClick={() => handleFailedDeliveryAction('TOMORROW')}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Reschedule for Tomorrow
                    </button>
                    <button 
                      onClick={() => {
                        const date = prompt("Enter custom date (e.g. MM/DD/YYYY):");
                        if (date) handleFailedDeliveryAction('CUSTOM', date);
                      }}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Input Custom Date
                    </button>
                    <button 
                      onClick={() => {
                        setIsFailedMenuOpen(false);
                        window.location.href = `tel:${selectedOrder.customer.phone}`;
                      }}
                      className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Phone size={18} /> Contact Customer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isFailedMenuOpen && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-end animate-in fade-in">
                <div className="w-full bg-white rounded-t-[40px] p-8 space-y-6 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Delivery Failed</h3>
                    <button onClick={() => setIsFailedMenuOpen(false)} className="p-2 text-stone-300"><X size={24} /></button>
                  </div>
                  <p className="text-xs text-stone-500 font-medium">Select an action to resolve this delivery issue:</p>
                  <div className="space-y-3">
                    <button 
                      onClick={() => handleFailedDeliveryAction('TOMORROW')}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Reschedule for Tomorrow
                    </button>
                    <button 
                      onClick={() => {
                        const date = prompt("Enter custom date (e.g. MM/DD/YYYY):");
                        if (date) handleFailedDeliveryAction('CUSTOM', date);
                      }}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Input Custom Date
                    </button>
                    <button 
                      onClick={() => {
                        setIsFailedMenuOpen(false);
                        window.location.href = `tel:${selectedOrder.customer.phone}`;
                      }}
                      className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Phone size={18} /> Contact Customer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isFailedMenuOpen && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-end animate-in fade-in">
                <div className="w-full bg-white rounded-t-[40px] p-8 space-y-6 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Delivery Failed</h3>
                    <button onClick={() => setIsFailedMenuOpen(false)} className="p-2 text-stone-300"><X size={24} /></button>
                  </div>
                  <p className="text-xs text-stone-500 font-medium">Select an action to resolve this delivery issue:</p>
                  <div className="space-y-3">
                    <button 
                      onClick={() => handleFailedDeliveryAction('TOMORROW')}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Reschedule for Tomorrow
                    </button>
                    <button 
                      onClick={() => {
                        const date = prompt("Enter custom date (e.g. MM/DD/YYYY):");
                        if (date) handleFailedDeliveryAction('CUSTOM', date);
                      }}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Input Custom Date
                    </button>
                    <button 
                      onClick={() => {
                        setIsFailedMenuOpen(false);
                        window.location.href = `tel:${selectedOrder.customer.phone}`;
                      }}
                      className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Phone size={18} /> Contact Customer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isFailedMenuOpen && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-end animate-in fade-in">
                <div className="w-full bg-white rounded-t-[40px] p-8 space-y-6 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Delivery Failed</h3>
                    <button onClick={() => setIsFailedMenuOpen(false)} className="p-2 text-stone-300"><X size={24} /></button>
                  </div>
                  <p className="text-xs text-stone-500 font-medium">Select an action to resolve this delivery issue:</p>
                  <div className="space-y-3">
                    <button 
                      onClick={() => handleFailedDeliveryAction('TOMORROW')}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Reschedule for Tomorrow
                    </button>
                    <button 
                      onClick={() => {
                        const date = prompt("Enter custom date (e.g. MM/DD/YYYY):");
                        if (date) handleFailedDeliveryAction('CUSTOM', date);
                      }}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Input Custom Date
                    </button>
                    <button 
                      onClick={() => {
                        setIsFailedMenuOpen(false);
                        window.location.href = `tel:${selectedOrder.customer.phone}`;
                      }}
                      className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Phone size={18} /> Contact Customer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isFailedMenuOpen && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-end animate-in fade-in">
                <div className="w-full bg-white rounded-t-[40px] p-8 space-y-6 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Delivery Failed</h3>
                    <button onClick={() => setIsFailedMenuOpen(false)} className="p-2 text-stone-300"><X size={24} /></button>
                  </div>
                  <p className="text-xs text-stone-500 font-medium">Select an action to resolve this delivery issue:</p>
                  <div className="space-y-3">
                    <button 
                      onClick={() => handleFailedDeliveryAction('TOMORROW')}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Reschedule for Tomorrow
                    </button>
                    <button 
                      onClick={() => {
                        const date = prompt("Enter custom date (e.g. MM/DD/YYYY):");
                        if (date) handleFailedDeliveryAction('CUSTOM', date);
                      }}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Input Custom Date
                    </button>
                    <button 
                      onClick={() => {
                        setIsFailedMenuOpen(false);
                        window.location.href = `tel:${selectedOrder.customer.phone}`;
                      }}
                      className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Phone size={18} /> Contact Customer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isFailedMenuOpen && (
              <div className="fixed inset-0 bg-black/60 z-[300] flex items-end animate-in fade-in">
                <div className="w-full bg-white rounded-t-[40px] p-8 space-y-6 animate-in slide-in-from-bottom">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black uppercase tracking-tighter">Delivery Failed</h3>
                    <button onClick={() => setIsFailedMenuOpen(false)} className="p-2 text-stone-300"><X size={24} /></button>
                  </div>
                  <p className="text-xs text-stone-500 font-medium">Select an action to resolve this delivery issue:</p>
                  <div className="space-y-3">
                    <button 
                      onClick={() => handleFailedDeliveryAction('TOMORROW')}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Reschedule for Tomorrow
                    </button>
                    <button 
                      onClick={() => {
                        const date = prompt("Enter custom date (e.g. MM/DD/YYYY):");
                        if (date) handleFailedDeliveryAction('CUSTOM', date);
                      }}
                      className="w-full py-5 bg-stone-100 text-black rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Calendar size={18} /> Input Custom Date
                    </button>
                    <button 
                      onClick={() => {
                        setIsFailedMenuOpen(false);
                        window.location.href = `tel:${selectedOrder.customer.phone}`;
                      }}
                      className="w-full py-5 bg-black text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-3 active:scale-95 transition-all"
                    >
                      <Phone size={18} /> Contact Customer
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </HashRouter>
  );
}
