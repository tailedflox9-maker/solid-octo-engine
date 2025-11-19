import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Business, Category, BusinessData } from './types';
import CategoryGrid from './components/CategoryGrid';
import BusinessList from './components/BusinessList';
import UserNamePopup from './components/UserNamePopup';
import { GoogleGenAI, Type } from "@google/genai";
import * as SupabaseService from './supabaseClient';
import { User } from '@supabase/supabase-js';
import {
  hasUserName,
  trackUserVisit,
  initializeTracking,
  trackBusinessInteraction
} from './trackingService';

// --- HELPER FUNCTIONS ---
const formatPhoneNumber = (phoneNumber: string): string => {
    if (phoneNumber.length === 10) {
        return `+91 ${phoneNumber.slice(0, 5)} ${phoneNumber.slice(5)}`;
    }
    return phoneNumber;
};

// --- CORE COMPONENTS ---
const Header: React.FC = () => (
    <header className="bg-gradient-to-r from-primary to-secondary text-white text-center p-5 rounded-2xl mb-6 shadow-lg animate-fadeInUp">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          जवळा व्यवसाय निर्देशिका
        </h1>
        <p className="mt-1 text-sm opacity-90">तुमच्या गावातील सर्व व्यवसाय एकाच ठिकाणी!</p>
    </header>
);

// --- AI Assistant Components ---
interface AiResult {
    summary: string;
    results: Array<{
        type: 'business' | 'text';
        businessId?: string;
        content?: string;
    }>;
}

const AiAssistant: React.FC<{
    businesses: Business[];
    categories: Category[];
    onViewBusiness: (business: Business) => void;
    query: string;
    onQueryChange: (query: string) => void;
}> = ({ businesses, categories, onViewBusiness, query, onQueryChange }) => {
    const [response, setResponse] = useState<AiResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const businessMap = useMemo(() => new Map(businesses.map(b => [b.id, b])), [businesses]);

    const handleQuery = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;

        setIsLoading(true);
        setError('');
        setResponse(null);

        const businessContext = businesses.map(b => ({
            id: b.id,
            shopName: b.shopName,
            ownerName: b.ownerName,
            category: categories.find(c => c.id === b.category)?.name || 'Unknown',
            services: b.services,
            contact: b.contactNumber,
        }));

        const prompt = `You are a very helpful assistant for the "Jawala Business Directory".
        Your goal is to understand a user's request in Marathi and provide the most relevant information from the business list.

        Here is the list of all available businesses:
        ${JSON.stringify(businessContext, null, 2)}

        User's Request: "${query}"

        Analyze the request and respond with a JSON object. The JSON must contain:
        1.  "summary": A short, conversational summary of your findings in Marathi.
        2.  "results": An array of results. Each result can be one of two types:
            -   type: "business": If you find a relevant business, include its "businessId".
            -   type: "text": If the user asks for specific information (like a phone number) or if no business is a good match, provide a helpful answer in the "content" field.

        If you find multiple relevant businesses, list them all. If the request is generic or you cannot find a good match, provide a friendly text response.`;
        
        try {
            const modelName = process.env.AI_MODEL;
            if (!modelName) {
                throw new Error("AI_CONFIG_ERROR");
            }

            let jsonStr: string;
            if (modelName.startsWith('gemini') || modelName.startsWith('gemma')) {
                const apiKey = process.env.GOOGLE_API_KEY;
                if (!apiKey) {
                    throw new Error("GOOGLE_API_KEY_MISSING");
                }

                const ai = new GoogleGenAI({ apiKey });
                const result = await ai.models.generateContent({
                    model: modelName,
                    contents: prompt,
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                summary: { type: Type.STRING },
                                results: {
                                    type: Type.ARRAY,
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            type: { type: Type.STRING },
                                            businessId: { type: Type.STRING },
                                            content: { type: Type.STRING },
                                        }
                                    }
                                }
                            }
                        }
                    }
                });
                jsonStr = result.text.trim();
            } else if (modelName.startsWith('mistral') || modelName.startsWith('pixtral')) {
                 const apiKey = process.env.MISTRAL_API_KEY;
                 if (!apiKey) {
                    throw new Error("MISTRAL_API_KEY_MISSING");
                 }

                 const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({
                        model: modelName,
                        messages: [{ role: 'user', content: prompt }],
                        response_format: { type: "json_object" }
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(`MISTRAL_API_ERROR: ${errorData.message || response.statusText}`);
                }

                const data = await response.json();
                jsonStr = data.choices[0].message.content;
            } else {
                 throw new Error(`UNSUPPORTED_MODEL: ${modelName}`);
            }

            const parsedResponse = JSON.parse(jsonStr) as AiResult;
            setResponse(parsedResponse);
        } catch (err) {
            console.error("AI Chat Error:", err);
            
            let errorMessage = 'उत्तर मिळवताना एक समस्या आली.';
            let errorDetails = '';
            
            if (err instanceof Error) {
                // Configuration errors
                if (err.message === 'AI_CONFIG_ERROR') {
                    errorMessage = 'AI सेवा उपलब्ध नाही.';
                    errorDetails = 'कृपया प्रशासकाशी संपर्क साधा.';
                } 
                // API Key errors
                else if (err.message === 'GOOGLE_API_KEY_MISSING' || err.message === 'MISTRAL_API_KEY_MISSING') {
                    errorMessage = 'AI सेवा कॉन्फिगर केलेली नाही.';
                    errorDetails = 'कृपया प्रशासकाशी संपर्क साधा.';
                }
                // Unsupported model
                else if (err.message.startsWith('UNSUPPORTED_MODEL')) {
                    errorMessage = 'AI सेवा उपलब्ध नाही.';
                    errorDetails = 'कृपया प्रशासकाशी संपर्क साधा.';
                }
                // Network errors
                else if (err.message.includes('fetch') || err.message.includes('network') || err.message.includes('Failed to fetch')) {
                    errorMessage = 'इंटरनेट कनेक्शन तपासा.';
                    errorDetails = 'नेटवर्क त्रुटी: सर्व्हरशी संपर्क साधता आला नाही.';
                }
                // Rate limit errors
                else if (err.message.includes('rate limit') || err.message.includes('429') || err.message.includes('quota')) {
                    errorMessage = 'सेवा तात्पुरती उपलब्ध नाही.';
                    errorDetails = 'कृपया काही वेळाने पुन्हा प्रयत्न करा.';
                }
                // JSON parsing errors
                else if (err.message.includes('JSON') || err.message.includes('parse')) {
                    errorMessage = 'AI ने अवैध प्रतिसाद दिला.';
                    errorDetails = 'कृपया पुन्हा प्रयत्न करा.';
                }
                // Mistral API errors
                else if (err.message.startsWith('MISTRAL_API_ERROR')) {
                    errorMessage = 'AI सेवा उपलब्ध नाही.';
                    errorDetails = 'कृपया काही वेळाने पुन्हा प्रयत्न करा.';
                }
                // Authentication errors
                else if (err.message.includes('authentication') || err.message.includes('unauthorized') || err.message.includes('401')) {
                    errorMessage = 'AI सेवा कॉन्फिगर केलेली नाही.';
                    errorDetails = 'कृपया प्रशासकाशी संपर्क साधा.';
                }
                // Generic errors
                else {
                    errorMessage = 'AI सेवा उपलब्ध नाही.';
                    errorDetails = 'कृपया पुन्हा प्रयत्न करा किंवा प्रशासकाशी संपर्क साधा.';
                }
            } else {
                // Unknown error type
                errorMessage = 'अज्ञात त्रुटी आली.';
                errorDetails = 'कृपया पेज रीफ्रेश करून पुन्हा प्रयत्न करा.';
            }
            
            // Combine error message with details
            const fullError = errorDetails 
                ? `${errorMessage}\n\n${errorDetails}` 
                : errorMessage;
            
            setError(fullError);
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onQueryChange(e.target.value);
        if (response) setResponse(null);
        if (error) setError('');
    };
    
    const AiBusinessResultCard: React.FC<{business: Business}> = ({ business }) => (
        <div className="bg-surface rounded-lg p-3 shadow-subtle border-l-4 border-secondary flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
                <h4 className="font-bold text-primary text-sm truncate">{business.shopName}</h4>
                <p className="text-xs text-text-secondary truncate">{business.ownerName}</p>
                <p className="text-xs text-text-primary font-semibold mt-0.5">{formatPhoneNumber(business.contactNumber)}</p>
            </div>
            <button
                onClick={() => onViewBusiness(business)}
                className="bg-primary/10 text-primary font-bold py-1.5 px-3 rounded-lg hover:bg-primary/20 transition-colors text-sm whitespace-nowrap flex-shrink-0"
            >
                पहा
            </button>
        </div>
    );
    
    const AiResponseCard: React.FC<{aiResult: AiResult}> = ({aiResult}) => (
        <div className="mt-4 space-y-3 animate-fadeInUp">
            <div className="p-3 bg-primary/10 rounded-lg">
                <p className="font-semibold text-text-primary text-sm">{aiResult.summary}</p>
            </div>
            <div className="space-y-2">
                {aiResult.results.map((result, index) => {
                    if (result.type === 'business' && result.businessId) {
                        const business = businessMap.get(result.businessId);
                        return business ? <AiBusinessResultCard key={business.id} business={business} /> : null;
                    }
                    if (result.type === 'text' && result.content) {
                        return <p key={index} className="p-3 bg-surface rounded-lg text-text-secondary shadow-subtle text-sm">{result.content}</p>
                    }
                    return null;
                })}
            </div>
        </div>
    );

    return (
        <div className="bg-surface p-5 rounded-2xl shadow-card mb-8 animate-fadeInUp" style={{ animationDelay: '50ms' }}>
            <div className="flex items-center gap-2 mb-3">
                <i className="fa-solid fa-wand-magic-sparkles text-xl text-primary"></i>
                <h2 className="text-xl font-bold text-primary">शोध आणि AI मदतनीस</h2>
            </div>
            <p className="text-text-secondary text-sm mb-3">व्यवसाय, मालक किंवा संपर्क शोधा. थेट सापडले नाही, तर आमचा AI मदतनीस मदत करेल!</p>
            
            <form onSubmit={handleQuery} className="flex gap-2">
                <input
                    type="text"
                    value={query}
                    onChange={handleInputChange}
                    placeholder="उदा. 'होम डिलिव्हरी करणारे किराणा दुकान' किंवा 'गाडी दुरुस्ती करणारे गॅरेज'"
                    className="flex-grow px-4 py-2.5 border-2 border-border-color rounded-lg bg-background focus:outline-none focus:border-primary text-sm"
                    disabled={isLoading}
                />
                <button 
                    type="submit" 
                    disabled={isLoading || !query.trim()} 
                    className="px-5 py-2.5 bg-primary text-white font-semibold rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2 disabled:bg-primary disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
                >
                    {isLoading ? (
                        <>
                            <i className="fas fa-spinner fa-spin text-sm"></i>
                            <span className="hidden sm:inline">शोधत आहे...</span>
                        </>
                    ) : (
                        <>
                            <i className="fa-solid fa-wand-magic-sparkles text-sm"></i>
                            <span className="hidden sm:inline">AI शोध</span>
                        </>
                    )}
                </button>
            </form>
            
            {isLoading && !response && (
                <div className="flex items-center justify-center p-4 mt-3">
                    <div className="w-6 h-6 border-3 border-t-primary border-gray-200 rounded-full animate-spin"></div>
                    <p className="ml-3 text-text-secondary text-sm animate-pulse">तुमच्यासाठी माहिती शोधत आहे...</p>
                </div>
            )}
            {error && (
                <div className="mt-4 p-4 bg-red-50 border-2 border-red-200 rounded-lg animate-fadeInUp">
                    <div className="flex items-start gap-3">
                        <i className="fas fa-exclamation-triangle text-red-600 text-xl mt-0.5"></i>
                        <div className="flex-1">
                            <h4 className="font-bold text-red-800 mb-1">त्रुटी</h4>
                            <p className="text-red-700 text-sm whitespace-pre-line">{error}</p>
                            <button 
                                onClick={() => setError('')}
                                className="mt-3 text-xs text-red-600 hover:text-red-800 font-semibold underline"
                            >
                                बंद करा
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {response && <AiResponseCard aiResult={response} />}
        </div>
    );
};

// --- ADVANCED FEATURE COMPONENTS ---
const BusinessDetailModal: React.FC<{
    business: Business | null;
    onClose: () => void;
}> = ({ business, onClose }) => {
    const [isSharing, setIsSharing] = useState(false);

    useEffect(() => {
        if (business) {
            document.body.style.overflow = 'hidden';
            trackBusinessInteraction('view', business.id);
        } else {
            document.body.style.overflow = 'unset';
        }
        
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [business]);

    const shareBusinessDetails = async () => {
        if (!business) return;
        setIsSharing(true);
        
        trackBusinessInteraction('share', business.id);
    
        const baseUrl = `${window.location.origin}${window.location.pathname}`;
        const shareUrl = `${baseUrl}?businessId=${business.id}`;
    
        const details = [
            `*${business.shopName}*`,
            `👤 ${business.ownerName}`,
            `📞 ${formatPhoneNumber(business.contactNumber)}`,
        ];
    
        if (business.address) {
            details.push(`📍 ${business.address}`);
        }
        if (business.services && business.services.length > 0) {
            details.push(`🛠️ सेवा: ${business.services.join(', ')}`);
        }
        
        details.push(`\n_~ जवळा व्यवसाय निर्देशिका द्वारे पाठवले ~_`);
    
        const shareText = details.join('\n');
        
        if (navigator.share) {
            try {
                await navigator.share({
                    title: `${business.shopName} | जवळा व्यवसाय निर्देशिका`,
                    text: shareText, 
                    url: shareUrl,
                });
            } catch (error) {
                console.error('Sharing failed or was cancelled:', error);
            } finally {
                setIsSharing(false);
            }
        } else {
            try {
                await navigator.clipboard.writeText(`${shareText}\n\n${shareUrl}`);
                alert('शेअरिंग समर्थित नाही. तपशील आणि लिंक क्लिपबोर्डवर कॉपी केली आहे!');
            } catch (err) {
                alert('तपशील कॉपी करू शकलो नाही.');
                console.error('Clipboard copy failed:', err);
            } finally {
                setIsSharing(false);
            }
        }
    };
    
    if (!business) return null;

    const paymentIconMap: Record<string, string> = {
        'UPI': 'fa-solid fa-qrcode', 
        'Cash': 'fa-solid fa-money-bill-wave', 
        'Card': 'fa-regular fa-credit-card'
    };

    const DetailItem: React.FC<{icon: string, label: string, value?: string}> = ({icon, label, value}) => (
        value ? (
            <div className="flex items-start gap-4">
                <i className={`fas ${icon} w-6 text-center text-secondary text-xl pt-1`}></i>
                <div>
                    <p className="font-semibold text-text-primary">{label}</p>
                    <p className="text-text-secondary">{value}</p>
                </div>
            </div>
        ) : null
    );
    
    const hasExtraDetails = business.address || business.openingHours || business.homeDelivery;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-40 p-4 animate-fadeInUp" style={{animationDuration: '0.3s'}} onClick={onClose}>
            <div className="bg-background rounded-xl w-full max-w-md flex flex-col max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                <header className="bg-gradient-to-r from-primary to-secondary p-5 text-white relative">
                    <button 
                        onClick={onClose} 
                        className="absolute top-2 right-2 text-white/70 hover:text-white text-3xl w-10 h-10 flex items-center justify-center transition-colors"
                        aria-label="Close"
                    >
                        &times;
                    </button>
                    <h3 className="text-2xl font-bold pr-10">{business.shopName}</h3>
                    <p className="opacity-90 text-base">{business.ownerName}</p>
                </header>
                <main className="p-5 space-y-4 overflow-y-auto">
                    <a 
                        href={`tel:${business.contactNumber}`}
                        onClick={() => trackBusinessInteraction('call', business.id)}
                        className="flex items-center gap-4 p-4 bg-surface rounded-lg shadow-subtle hover:shadow-card transition-shadow"
                    >
                        <i className="fas fa-phone text-2xl text-primary"></i>
                        <div>
                            <p className="font-semibold text-text-primary">संपर्क</p>
                            <p className="text-lg text-primary font-bold tracking-wider">{formatPhoneNumber(business.contactNumber)}</p>
                        </div>
                    </a>
                    {hasExtraDetails && (
                      <div className="p-4 bg-surface rounded-lg shadow-subtle space-y-4">
                          <DetailItem icon="fa-map-marker-alt" label="पत्ता" value={business.address} />
                          <DetailItem icon="fa-clock" label="वेळ" value={business.openingHours} />
                          {business.homeDelivery && 
                              <div className="flex items-center gap-4">
                                  <i className="fas fa-bicycle w-6 text-center text-secondary text-xl"></i>
                                  <p className="font-bold text-green-700">होम डिलिव्हरी उपलब्ध</p>
                              </div>
                          }
                      </div>
                    )}
                    {business.services && business.services.length > 0 && 
                        <div className="p-4 bg-surface rounded-lg shadow-subtle">
                            <h4 className="font-bold text-text-primary mb-3">सेवा/उत्पादने:</h4>
                            <div className="flex flex-wrap gap-2">
                                {business.services.map(s => (
                                    <span key={s} className="bg-primary/10 text-primary text-sm font-semibold px-3 py-1 rounded-full">
                                        {s}
                                    </span>
                                ))}
                            </div>
                        </div>
                    }
                    {business.paymentOptions && business.paymentOptions.length > 0 &&
                      <div className="p-4 bg-surface rounded-lg shadow-subtle">
                         <h4 className="font-bold text-text-primary mb-3">पेमेंट पर्याय:</h4>
                         <div className="flex items-center gap-6">
                             {business.paymentOptions.map(p => (
                               <div key={p} className="flex flex-col items-center gap-1 text-text-secondary">
                                 <i className={`${paymentIconMap[p] || 'fa-solid fa-dollar-sign'} text-3xl text-secondary`}></i>
                                 <span className="text-sm font-semibold">{p}</span>
                               </div>
                              ))}
                         </div>
                      </div>
                    }
                </main>
                <footer className="p-4 border-t border-border-color grid grid-cols-2 gap-3 bg-background/70">
                    <a 
                        href={`https://wa.me/91${business.contactNumber}?text=${encodeURIComponent('नमस्कार, मी "जवळा व्यवसाय निर्देशिका" वरून आपला संपर्क घेतला आहे.')}`}
                        onClick={() => trackBusinessInteraction('whatsapp', business.id)}
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="w-full text-center py-3 rounded-lg transition-all flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold"
                    >
                        <i className="fab fa-whatsapp text-xl"></i> WhatsApp
                    </a>
                    <button 
                        onClick={shareBusinessDetails} 
                        disabled={isSharing} 
                        className="w-full text-center py-3 rounded-lg transition-all flex items-center justify-center gap-2 bg-secondary hover:bg-secondary/90 text-white font-bold disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                        {isSharing ? (
                            <>
                                <i className="fas fa-spinner fa-spin"></i> शेअर करत आहे...
                            </>
                        ) : (
                            <>
                                <i className="fas fa-share text-xl"></i> शेअर करा
                            </>
                        )}
                    </button>
                </footer>
            </div>
        </div>
    );
};

const Footer: React.FC<{ onAdminLoginClick: () => void }> = ({ onAdminLoginClick }) => {
    const [showContactPopup, setShowContactPopup] = useState(false);
    
    useEffect(() => {
        if (showContactPopup) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [showContactPopup]);
    
    return (
        <>
            <footer className="bg-gradient-to-r from-primary to-secondary text-white p-8 mt-16 text-center shadow-lg rounded-t-xl">
                <div className="relative z-10 space-y-6">
                    <h3 className="text-2xl font-bold">तुमचा व्यवसाय वाढवा!</h3>
                    <p className="text-md opacity-90 max-w-lg mx-auto">तुमच्या व्यवसायाची माहिती आमच्या निर्देशिकेत जोडून संपूर्ण गावापर्यंत पोहोचा.</p>
                    
                    <button
                        onClick={() => setShowContactPopup(true)}
                        className="inline-flex items-center justify-center gap-3 px-8 py-4 bg-white/20 hover:bg-white/30 text-white rounded-full transition-all transform hover:scale-105 shadow-lg font-bold backdrop-blur-sm text-lg"
                    >
                        <i className="fas fa-address-book text-xl"></i>
                        <span>संपर्क करा</span>
                    </button>
                    
                    <div className="text-sm opacity-80 pt-2">
                        © {new Date().getFullYear()} Jawala Vyapar
                    </div>
                </div>
            </footer>
            {/* Contact Popup */}
            {showContactPopup && (
                <div 
                    className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fadeInUp backdrop-blur-sm" 
                    style={{animationDuration: '0.3s'}} 
                    onClick={() => setShowContactPopup(false)}
                >
                    <div 
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-fadeInUp" 
                        style={{animationDelay: '0.1s'}} 
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-5">
                            <h3 className="text-2xl font-bold text-primary">संपर्क करा</h3>
                            <button 
                                onClick={() => setShowContactPopup(false)}
                                className="text-gray-400 hover:text-gray-600 transition-colors"
                                aria-label="बंद करा"
                            >
                                <i className="fas fa-times text-xl"></i>
                            </button>
                        </div>
                        <div className="space-y-3">
                            <a 
                                href={`https://wa.me/917775875877?text=${encodeURIComponent('नमस्कार, मला माझा व्यवसाय "जवळा व्यवसाय निर्देशिका" मध्ये जोडायचा आहे.')}`}
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="flex items-center gap-3 px-4 py-3 bg-green-50 hover:bg-green-100 rounded-xl transition-all text-green-800 font-semibold border-2 border-green-200 hover:border-green-300"
                            >
                                <i className="fab fa-whatsapp text-2xl text-green-600"></i>
                                <span>जय वानखेडे</span>
                            </a>
                            <a 
                                href={`https://wa.me/919922287156?text=${encodeURIComponent('नमस्कार, मला माझा व्यवसाय "जवळा व्यवसाय निर्देशिका" मध्ये जोडायचा आहे.')}`}
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="flex items-center gap-3 px-4 py-3 bg-green-50 hover:bg-green-100 rounded-xl transition-all text-green-800 font-semibold border-2 border-green-200 hover:border-green-300"
                            >
                                <i className="fab fa-whatsapp text-2xl text-green-600"></i>
                                <span>गोलू काळबांडे</span>
                            </a>
                            
                            <div className="relative my-4">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-gray-300"></div>
                                </div>
                                <div className="relative flex justify-center text-sm">
                                    <span className="px-2 bg-white text-gray-500">किंवा</span>
                                </div>
                            </div>
                            
                            <button
                                onClick={() => {
                                    setShowContactPopup(false);
                                    onAdminLoginClick();
                                }}
                                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-blue-50 hover:bg-blue-100 rounded-xl transition-all text-blue-800 font-semibold border-2 border-blue-200 hover:border-blue-300"
                            >
                                <i className="fas fa-user-shield text-2xl text-blue-600"></i>
                                <span>ॲडमिन लॉगिन</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

// --- ADMIN COMPONENTS ---
const LoginModal: React.FC<{ onLoginSuccess: (user: User) => void, onClose: () => void }> = ({ onLoginSuccess, onClose }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, []);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            const { user } = await SupabaseService.signIn(email, password);
            onLoginSuccess(user);
        } catch (err: any) {
            console.error('Login error:', err);
            setError(err.message || 'लॉगिन अयशस्वी. कृपया पुन्हा प्रयत्न करा.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-surface rounded-xl shadow-xl w-full max-w-sm p-6 animate-fadeInUp relative" style={{animationDuration: '0.3s'}} onClick={e => e.stopPropagation()}>
                <button 
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
                    aria-label="बंद करा"
                >
                    <i className="fas fa-times text-xl"></i>
                </button>
                <h3 className="text-2xl font-bold text-primary mb-4 text-center">ॲडमिन लॉगिन</h3>
                <form onSubmit={handleLogin} className="space-y-4">
                    <input 
                        type="email" 
                        value={email} 
                        onChange={e => setEmail(e.target.value)} 
                        placeholder="ईमेल" 
                        className="w-full p-3 border-2 border-border-color rounded-lg focus:outline-none focus:border-primary" 
                        required 
                        disabled={isLoading}
                    />
                    <input 
                        type="password" 
                        value={password} 
                        onChange={e => setPassword(e.target.value)} 
                        placeholder="पासवर्ड" 
                        className="w-full p-3 border-2 border-border-color rounded-lg focus:outline-none focus:border-primary" 
                        required 
                        disabled={isLoading}
                    />
                    {error && <p className="text-red-500 text-sm text-center">{error}</p>}
                    <button 
                        type="submit" 
                        disabled={isLoading}
                        className="w-full bg-primary hover:bg-primary/90 text-white font-bold py-3 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                    >
                        {isLoading ? 'लॉगिन करत आहे...' : 'लॉगिन करा'}
                    </button>
                </form>
            </div>
        </div>
    );
};

const AdminDashboard: React.FC<{
    onAdd: () => void;
    onEdit: () => void;
    onClose: () => void;
    onLogout: () => void;
}> = ({ onAdd, onEdit, onClose, onLogout }) => {
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, []);

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fadeInUp" style={{animationDuration: '0.3s'}} onClick={onClose}>
            <div className="bg-surface rounded-xl shadow-xl w-full max-w-sm p-6 text-center" onClick={e => e.stopPropagation()}>
                <h3 className="text-2xl font-bold text-primary mb-6">ॲडमिन पॅनल</h3>
                <div className="space-y-4">
                    <button 
                        onClick={onAdd} 
                        className="w-full text-lg py-4 px-6 bg-primary text-white font-bold rounded-lg hover:bg-primary/90 transition-all flex items-center justify-center gap-3"
                    >
                        <i className="fas fa-plus-circle"></i> नवीन व्यवसाय जोडा
                    </button>
                    <button 
                        onClick={onEdit} 
                        className="w-full text-lg py-4 px-6 bg-secondary text-white font-bold rounded-lg hover:bg-secondary/90 transition-all flex items-center justify-center gap-3"
                    >
                        <i className="fas fa-edit"></i> व्यवसाय संपादित करा
                    </button>
                    <button 
                        onClick={onLogout} 
                        className="w-full text-lg py-4 px-6 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-all flex items-center justify-center gap-3"
                    >
                        <i className="fas fa-sign-out-alt"></i> लॉगआउट
                    </button>
                </div>
                <button onClick={onClose} className="mt-6 text-sm text-text-secondary hover:underline">बंद करा</button>
            </div>
        </div>
    );
};

const EditBusinessList: React.FC<{
    businesses: Business[];
    onSelect: (business: Business) => void;
    onDelete: (businessId: string) => void;
    onClose: () => void;
    onBack: () => void;
}> = ({ businesses, onSelect, onDelete, onClose, onBack }) => {
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, []);

    const handleDelete = async (businessId: string, businessName: string) => {
        if (!confirm(`खात्री आहे का की तुम्ही "${businessName}" हटवू इच्छिता?`)) return;
        
        setDeletingId(businessId);
        try {
            await onDelete(businessId);
        } catch (error) {
            console.error('Delete error:', error);
            alert('व्यवसाय हटवताना त्रुटी आली');
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fadeInUp" style={{animationDuration: '0.3s'}} onClick={onClose}>
            <div className="bg-surface rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                <header className="p-4 border-b border-border-color flex justify-between items-center sticky top-0 bg-surface/95 backdrop-blur-sm rounded-t-xl">
                    <h3 className="text-xl font-bold text-primary">व्यवसाय संपादित करा</h3>
                    <button onClick={onBack} className="text-sm text-text-secondary hover:text-primary transition-colors flex items-center gap-2">
                        <i className="fas fa-arrow-left"></i> मागे
                    </button>
                </header>
                <ul className="overflow-y-auto p-4 space-y-2">
                    {businesses.slice().sort((a,b) => a.shopName.localeCompare(b.shopName)).map(b => (
                        <li key={b.id} className="flex justify-between items-center p-3 bg-background rounded-lg hover:shadow-subtle transition-shadow">
                            <div className="flex-1 min-w-0 pr-3">
                                <p className="font-semibold truncate">{b.shopName}</p>
                                <p className="text-sm text-text-secondary truncate">{b.ownerName}</p>
                            </div>
                            <div className="flex gap-2 flex-shrink-0">
                                <button 
                                    onClick={() => onSelect(b)} 
                                    className="px-3 py-2 bg-secondary text-white font-semibold rounded-lg text-sm hover:bg-secondary/90 transition-colors"
                                >
                                    संपादित करा
                                </button>
                                <button 
                                    onClick={() => handleDelete(b.id, b.shopName)}
                                    disabled={deletingId === b.id}
                                    className="px-3 py-2 bg-red-600 text-white font-semibold rounded-lg text-sm hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                                >
                                    {deletingId === b.id ? '...' : 'हटवा'}
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
                <footer className="p-3 border-t border-border-color text-center sticky bottom-0 bg-surface/95 backdrop-blur-sm rounded-b-xl">
                    <button onClick={onClose} className="text-sm text-text-secondary hover:underline">बंद करा</button>
                </footer>
            </div>
        </div>
    );
};

interface CustomDropdownProps {
    options: Category[];
    selectedId: string | undefined;
    onChange: (id: string) => void;
    placeholder: string;
}

const CustomDropdown: React.FC<CustomDropdownProps> = ({ options, selectedId, onChange, placeholder }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const selectedOption = options.find(opt => opt.id === selectedId);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative w-full md:col-span-2" ref={dropdownRef}>
            <button 
                type="button" 
                onClick={() => setIsOpen(!isOpen)} 
                className="w-full p-3 border-2 border-border-color rounded-lg text-left bg-surface flex justify-between items-center focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
            >
                <span className={selectedOption ? 'text-text-primary' : 'text-text-secondary/80'}>
                    {selectedOption ? selectedOption.name : placeholder}
                </span>
                <i className={`fas fa-chevron-down text-text-secondary transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}></i>
            </button>
            {isOpen && (
                <ul className="absolute z-20 w-full mt-1 bg-surface border-2 border-border-color rounded-lg shadow-lg max-h-60 overflow-y-auto animate-fadeInUp" style={{ animationDuration: '200ms' }}>
                    {options.map(option => (
                        <li 
                            key={option.id} 
                            onClick={() => { onChange(option.id); setIsOpen(false); }} 
                            className={`p-3 cursor-pointer hover:bg-primary/10 transition-colors ${selectedId === option.id ? 'bg-primary/10 font-semibold text-primary' : ''}`}
                        >
                            {option.name}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

const BusinessForm: React.FC<{ 
    categories: Category[], 
    onClose: () => void, 
    onSave: (business: Business) => void,
    existingBusiness: Business | null,
    isSaving: boolean,
    onBack: () => void
}> = ({ categories, onClose, onSave, existingBusiness, isSaving, onBack }) => {
    const [formData, setFormData] = useState<Omit<Partial<Business>, 'services'> & { services?: string }>({});
    const isEditing = !!existingBusiness;

    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, []);

    useEffect(() => {
        if (existingBusiness) {
            setFormData({
                ...existingBusiness,
                services: existingBusiness.services ? existingBusiness.services.join(', ') : '',
            });
        } else {
             setFormData({ paymentOptions: [], category: '' });
        }
    }, [existingBusiness]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };
    
    const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, checked, value } = e.target;
        if (name === 'homeDelivery') {
            setFormData({ ...formData, homeDelivery: checked });
        } else {
            const currentOptions = formData.paymentOptions || [];
            const newOptions = checked ? [...currentOptions, value] : currentOptions.filter(opt => opt !== value);
            setFormData({ ...formData, paymentOptions: newOptions });
        }
    };
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const businessToSave: Business = {
            id: existingBusiness?.id || '',
            shopName: formData.shopName || '',
            ownerName: formData.ownerName || '',
            contactNumber: formData.contactNumber || '',
            category: formData.category || 'other',
            address: formData.address,
            openingHours: formData.openingHours,
            homeDelivery: formData.homeDelivery,
            paymentOptions: formData.paymentOptions,
            services: typeof formData.services === 'string' ? formData.services.split(',').map(s => s.trim()).filter(Boolean) : [],
        };
        onSave(businessToSave);
    };
    
    const inputStyles = "w-full p-3 border-2 border-border-color rounded-lg bg-surface focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all";

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fadeInUp" style={{animationDuration: '0.3s'}} onClick={onClose}>
            <form onSubmit={handleSubmit} className="bg-surface rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-2xl font-bold text-primary">
                        {isEditing ? 'व्यवसाय अपडेट करा' : 'नवीन व्यवसाय जोडा'}
                    </h3>
                    <button 
                        type="button"
                        onClick={onBack} 
                        className="text-sm text-text-secondary hover:text-primary transition-colors flex items-center gap-2 font-semibold"
                    >
                        <i className="fas fa-arrow-left"></i> मागे
                    </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input 
                        name="shopName" 
                        value={formData.shopName || ''} 
                        onChange={handleChange} 
                        placeholder="दुकानाचे नाव" 
                        className={inputStyles} 
                        required 
                        disabled={isSaving} 
                    />
                    <input 
                        name="ownerName" 
                        value={formData.ownerName || ''} 
                        onChange={handleChange} 
                        placeholder="मालकाचे नाव" 
                        className={inputStyles} 
                        required 
                        disabled={isSaving} 
                    />
                    <input 
                        name="contactNumber" 
                        type="tel" 
                        value={formData.contactNumber || ''} 
                        onChange={handleChange} 
                        placeholder="संपर्क क्रमांक" 
                        className={`${inputStyles} md:col-span-2`} 
                        required 
                        disabled={isSaving} 
                        pattern="[0-9]{10}"
                        title="कृपया 10 अंकी मोबाईल नंबर प्रविष्ट करा"
                    />
                    <CustomDropdown 
                        options={categories} 
                        selectedId={formData.category} 
                        onChange={id => setFormData({...formData, category: id})} 
                        placeholder="श्रेणी निवडा" 
                    />
                    <textarea 
                        name="address" 
                        value={formData.address || ''} 
                        onChange={handleChange} 
                        placeholder="पत्ता" 
                        className={`${inputStyles} md:col-span-2`} 
                        disabled={isSaving}
                        rows={2}
                    />
                    <input 
                        name="openingHours" 
                        value={formData.openingHours || ''} 
                        onChange={handleChange} 
                        placeholder="उघडण्याची वेळ (उदा. सकाळी १० ते रात्री ९)" 
                        className={`${inputStyles} md:col-span-2`} 
                        disabled={isSaving} 
                    />
                    <textarea 
                        name="services" 
                        value={formData.services || ''} 
                        onChange={handleChange} 
                        placeholder="सेवा/उत्पादने (कॉमाने वेगळे करा)" 
                        className={`${inputStyles} md:col-span-2`} 
                        disabled={isSaving}
                        rows={2}
                    />
                </div>
                <div className="flex flex-wrap gap-4 my-4 items-center">
                   <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                       <input 
                           type="checkbox" 
                           name="homeDelivery" 
                           checked={formData.homeDelivery || false} 
                           onChange={handleCheckboxChange} 
                           disabled={isSaving}
                           className="w-3.5 h-3.5 accent-primary cursor-pointer"
                       /> 
                       <span>होम डिलिव्हरी</span>
                   </label>
                   <div className="flex items-center gap-3 text-sm">
                      <span className="font-semibold">पेमेंट:</span>
                      <label className="flex items-center gap-1 cursor-pointer">
                          <input 
                              type="checkbox" 
                              value="UPI" 
                              checked={formData.paymentOptions?.includes('UPI') || false} 
                              onChange={handleCheckboxChange} 
                              disabled={isSaving}
                              className="w-3.5 h-3.5 accent-primary cursor-pointer"
                          /> 
                          <span>UPI</span>
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer">
                          <input 
                              type="checkbox" 
                              value="Cash" 
                              checked={formData.paymentOptions?.includes('Cash') || false} 
                              onChange={handleCheckboxChange} 
                              disabled={isSaving}
                              className="w-3.5 h-3.5 accent-primary cursor-pointer"
                          /> 
                          <span>Cash</span>
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer">
                          <input 
                              type="checkbox" 
                              value="Card" 
                              checked={formData.paymentOptions?.includes('Card') || false} 
                              onChange={handleCheckboxChange} 
                              disabled={isSaving}
                              className="w-3.5 h-3.5 accent-primary cursor-pointer"
                          /> 
                          <span>Card</span>
                      </label>
                   </div>
                </div>
                <button 
                    type="submit" 
                    disabled={isSaving} 
                    className="w-full bg-primary hover:bg-primary/90 text-white font-bold py-3 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                    {isSaving ? 'सेव्ह करत आहे...' : (isEditing ? 'अपडेट करा' : 'व्यवसाय जोडा')}
                </button>
            </form>
        </div>
    );
};

// --- MAIN APP ---
const App: React.FC = () => {
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [businessData, setBusinessData] = useState<BusinessData>({ categories: [], businesses: [] });
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [viewedBusiness, setViewedBusiness] = useState<Business | null>(null);
    
    const [showUserNamePopup, setShowUserNamePopup] = useState<boolean>(false);
  
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [showLogin, setShowLogin] = useState(false);
    const [adminView, setAdminView] = useState<'dashboard' | 'add' | 'edit-list' | 'analytics' | null>(null);
    const [businessToEdit, setBusinessToEdit] = useState<Business | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const [installPromptEvent, setInstallPromptEvent] = useState<any>(null);

    useEffect(() => {
        const loadData = async () => {
            try {
                const CacheService = await import('./cacheService');
                
                const cachedData = await Promise.all([
                    CacheService.getCachedBusinesses(),
                    CacheService.getCachedCategories(),
                ]).catch(() => [[], []]);

                if (cachedData[0].length > 0) {
                    setBusinessData({
                        categories: cachedData[1].sort((a, b) => a.name.localeCompare(b.name)),
                        businesses: cachedData[0]
                    });
                    setIsLoading(false);
                }

                const syncResult = await CacheService.smartSync(
                    async () => {
                        const version = await SupabaseService.getDataVersion();
                        return {
                            ...version,
                            last_sync: Date.now(),
                        };
                    },
                    async () => {
                        const [categories, businesses] = await Promise.all([
                            SupabaseService.fetchCategories(),
                            SupabaseService.fetchBusinesses()
                        ]);
                        return { categories, businesses };
                    }
                );

                if (syncResult.action !== 'no_change') {
                    console.log(`📱 Data ${syncResult.fromCache ? 'from cache' : 'synced from server'}`);
                    setBusinessData({
                        categories: syncResult.categories.sort((a, b) => a.name.localeCompare(b.name)),
                        businesses: syncResult.businesses
                    });
                }

                const params = new URLSearchParams(window.location.search);
                const businessId = params.get('businessId');
                if (businessId) {
                    const businessToView = syncResult.businesses.find(b => b.id === businessId);
                    if (businessToView) {
                        setTimeout(() => {
                            setViewedBusiness(businessToView);
                            window.history.replaceState({}, document.title, window.location.pathname);
                        }, 100);
                    }
                }

                const user = await SupabaseService.getCurrentUser();
                if (user) {
                    const isAdmin = await SupabaseService.isUserAdmin(user.id);
                    if (isAdmin) {
                        setCurrentUser(user);
                    }
                }
            } catch (error) {
                console.error('Error loading data:', error);
                alert('डेटा लोड करताना त्रुटी आली. पेज रीफ्रेश करा.');
            } finally {
                setIsLoading(false);
            }
        };

        loadData();

        const subscription = SupabaseService.subscribeToBusinessChanges(async (payload) => {
            console.log('🔄 Real-time change detected:', payload.eventType);
            
            const CacheService = await import('./cacheService');
            
            if (payload.eventType === 'INSERT' && payload.new) {
                const newBusiness = SupabaseService.dbBusinessToBusiness(payload.new);
                await CacheService.updateCachedBusiness(newBusiness);
                setBusinessData(prev => ({
                    ...prev,
                    businesses: [newBusiness, ...prev.businesses]
                }));
            } else if (payload.eventType === 'UPDATE' && payload.new) {
                const updatedBusiness = SupabaseService.dbBusinessToBusiness(payload.new);
                await CacheService.updateCachedBusiness(updatedBusiness);
                setBusinessData(prev => ({
                    ...prev,
                    businesses: prev.businesses.map(b => 
                        b.id === updatedBusiness.id ? updatedBusiness : b
                    )
                }));
            } else if (payload.eventType === 'DELETE' && payload.old) {
                await CacheService.deleteCachedBusiness(payload.old.id);
                setBusinessData(prev => ({
                    ...prev,
                    businesses: prev.businesses.filter(b => b.id !== payload.old.id)
                }));
            }
            
            try {
                const newVersion = await SupabaseService.getDataVersion();
                await CacheService.setLocalVersion({
                    ...newVersion,
                    last_sync: Date.now(),
                });
            } catch (error) {
                console.error('Failed to update version:', error);
            }
        });

        return () => {
            subscription.unsubscribe();
        };
    }, []);

    useEffect(() => {
        const checkUserName = async () => {
            if (!hasUserName()) {
                setTimeout(() => {
                    setShowUserNamePopup(true);
                }, 1500);
            } else {
                await initializeTracking();
            }
        };
        
        checkUserName();
    }, []);

    useEffect(() => {
        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault();
            setInstallPromptEvent(e);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

        const handleAppInstalled = () => {
            setInstallPromptEvent(null);
        };

        window.addEventListener('appinstalled', handleAppInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, []);


    const handleCategorySelect = useCallback((categoryId: string | null) => {
        setSelectedCategory(categoryId);
        if (categoryId !== null) {
          setTimeout(() => {
            const businessListElement = document.getElementById('business-list-anchor');
            if (businessListElement) {
              const yOffset = -20;
              const y = businessListElement.getBoundingClientRect().top + window.pageYOffset + yOffset;
              window.scrollTo({ top: y, behavior: 'smooth' });
            }
          }, 100);
        }
    }, []);
    
    const handleSaveUserName = async (name: string) => {
        try {
            await trackUserVisit(name);
            setShowUserNamePopup(false);
        } catch (error) {
            console.error('Error saving user name:', error);
            setShowUserNamePopup(false);
        }
    };
    
    const handleAdminLoginClick = () => setShowLogin(true);
    
    const handleInstallClick = async () => {
        if (!installPromptEvent) return;
        
        installPromptEvent.prompt();
        const { outcome } = await installPromptEvent.userChoice;
        if (outcome === 'accepted') {
            setInstallPromptEvent(null);
        }
    };
    const handleLoginSuccess = (user: User) => {
        setCurrentUser(user);
        setShowLogin(false);
        setAdminView('dashboard');
    };

    const handleLogout = async () => {
        try {
            await SupabaseService.signOut();
            setCurrentUser(null);
            setAdminView(null);
            alert('तुम्ही यशस्वीरित्या लॉगआउट झाला आहात.');
        } catch (error) {
            console.error('Logout error:', error);
            alert('लॉगआउट करताना त्रुटी आली.');
        }
    };

    const handleCloseAdmin = () => { 
        setAdminView(null); 
        setBusinessToEdit(null); 
    };

    const handleSaveBusiness = async (businessToSave: Business) => {
        setIsSaving(true);
        try {
            if (businessToSave.id) {
                await SupabaseService.updateBusiness(businessToSave);
                alert('व्यवसाय यशस्वीरित्या अपडेट झाला!');
            } else {
                await SupabaseService.addBusiness(businessToSave);
                alert('व्यवसाय यशस्वीरित्या जोडला गेला!');
            }

            const businesses = await SupabaseService.fetchBusinesses();
            setBusinessData(prev => ({ ...prev, businesses }));
            
            setAdminView('dashboard');
            setBusinessToEdit(null);
        } catch (error: any) {
            console.error('Save error:', error);
            alert(`व्यवसाय सेव्ह करताना त्रुटी: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteBusiness = async (businessId: string) => {
        try {
            await SupabaseService.deleteBusiness(businessId);
            
            const businesses = await SupabaseService.fetchBusinesses();
            setBusinessData(prev => ({ ...prev, businesses }));
            
            alert('व्यवसाय यशस्वीरित्या हटवला!');
        } catch (error: any) {
            console.error('Delete error:', error);
            throw error;
        }
    };

    const filteredBusinesses = useMemo(() => {
        const baseList = businessData.businesses;
        const searchTermLower = searchTerm.toLowerCase();

        if (searchTerm) {
            return baseList.filter(business =>
                business.shopName.toLowerCase().includes(searchTermLower) ||
                business.ownerName.toLowerCase().includes(searchTermLower) ||
                business.contactNumber.includes(searchTermLower)
            );
        }

        if (selectedCategory) {
            return baseList.filter(business => business.category === selectedCategory);
        }

        return baseList;
    }, [businessData.businesses, searchTerm, selectedCategory]);

    const businessCounts = useMemo(() => {
        return businessData.businesses.reduce((acc, business) => {
            acc[business.category] = (acc[business.category] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
    }, [businessData.businesses]);

    if (isLoading) return null; // Just show nothing while loading

    const selectedCategoryDetails = selectedCategory ? businessData.categories.find(c => c.id === selectedCategory) : null;
    const isSearching = searchTerm.length > 0;

    return (
        <div className="min-h-screen flex flex-col">
            <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 max-w-4xl flex-grow">
                <Header />

                <AiAssistant 
                    businesses={businessData.businesses} 
                    categories={businessData.categories} 
                    onViewBusiness={setViewedBusiness} 
                    query={searchTerm} 
                    onQueryChange={setSearchTerm} 
                />

                {!isSearching && (
                    <div className="mb-6">
                        <CategoryGrid 
                            categories={businessData.categories} 
                            businessCounts={businessCounts} 
                            selectedCategory={selectedCategory} 
                            onCategorySelect={handleCategorySelect} 
                        />
                    </div>
                )}
                
                <div id="business-list-anchor" className="scroll-mt-4"></div>
                
                {isSearching && filteredBusinesses.length > 0 && (
                    <div className="text-center mb-6">
                        <h2 className="text-3xl font-bold text-text-primary">
                            "<span className="text-primary">{searchTerm}</span>" साठी शोध परिणाम 
                            <span className="text-xl font-normal text-text-secondary ml-2">({filteredBusinesses.length})</span>
                        </h2>
                    </div>
                )}
                
                {!isSearching && selectedCategoryDetails && (
                     <div className="text-center mb-6">
                        <i className={`${selectedCategoryDetails.icon} text-4xl text-primary mb-2`}></i>
                        <h2 className="text-3xl font-bold text-text-primary">
                            {selectedCategoryDetails.name}
                            <span className="text-xl font-normal text-text-secondary ml-2">({filteredBusinesses.length})</span>
                        </h2>
                    </div>
                )}

                <div id="business-list">
                    <BusinessList 
                        businesses={filteredBusinesses} 
                        categories={businessData.categories} 
                        selectedCategoryId={selectedCategory} 
                        onViewDetails={setViewedBusiness}
                        isSearching={isSearching} 
                    />
                </div>
            </main>

            {installPromptEvent && (
                <button
                    onClick={handleInstallClick}
                    className="fixed bottom-6 right-6 z-50 flex items-center justify-center gap-3 px-5 py-3 bg-gradient-to-r from-primary to-secondary text-white font-bold rounded-full shadow-lg transform transition-all hover:scale-105 animate-fadeInUp"
                    style={{ animationDuration: '0.5s' }}
                    title="तुमच्या डिव्हाइसवर ॲप इंस्टॉल करा"
                >
                    <img src="/jdlogo.png" alt="App Icon" className="w-6 h-6" />
                    <span>ॲप इंस्टॉल करा</span>
                </button>
            )}

            <BusinessDetailModal business={viewedBusiness} onClose={() => setViewedBusiness(null)} />
            
            {showUserNamePopup && <UserNamePopup onSave={handleSaveUserName} />}
            
            {showLogin && <LoginModal onLoginSuccess={handleLoginSuccess} onClose={() => setShowLogin(false)} />}
            
            {adminView === 'dashboard' && <AdminDashboard 
                onAdd={() => { setBusinessToEdit(null); setAdminView('add'); }}
                onEdit={() => setAdminView('edit-list')}
                onLogout={handleLogout}
                onClose={handleCloseAdmin}
            />}
            {adminView === 'edit-list' && <EditBusinessList
                businesses={businessData.businesses}
                onSelect={(business) => { setBusinessToEdit(business); setAdminView('add'); }}
                onDelete={handleDeleteBusiness}
                onBack={() => setAdminView('dashboard')}
                onClose={handleCloseAdmin}
            />}
            {adminView === 'add' && <BusinessForm
                categories={businessData.categories}
                onSave={handleSaveBusiness}
                existingBusiness={businessToEdit}
                isSaving={isSaving}
                onBack={() => {
                    setAdminView(businessToEdit ? 'edit-list' : 'dashboard');
                    setBusinessToEdit(null);
                }}
                onClose={() => {
                    setAdminView(businessToEdit ? 'edit-list' : 'dashboard');
                    setBusinessToEdit(null);
                }}
            />}

            <Footer onAdminLoginClick={handleAdminLoginClick} />
        </div>
    );
};

export default App;
