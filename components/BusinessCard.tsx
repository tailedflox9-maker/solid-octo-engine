import React from 'react';
import { Business } from '../types';

interface BusinessCardProps {
    business: Business;
    onViewDetails: (business: Business) => void;
}

const formatPhoneNumber = (phoneNumber: string): string => {
    if (phoneNumber.length === 10) {
        return `+91 ${phoneNumber.slice(0, 5)} ${phoneNumber.slice(5)}`;
    }
    return phoneNumber;
};

const BusinessCard: React.FC<BusinessCardProps> = ({ business, onViewDetails }) => {
    return (
        <div className={`relative group bg-surface rounded-xl shadow-card transition-all duration-300 border-l-4 border-transparent hover:border-primary hover:shadow-card-hover hover:scale-[1.02] ${business.homeDelivery ? 'pt-5 px-5 pb-8' : 'p-5'}`}>
            
            {business.homeDelivery && (
                <div className="absolute bottom-0 right-0 bg-secondary text-white text-xs font-bold px-3 py-1 rounded-tl-lg rounded-br-xl flex items-center gap-1.5" title="होम डिलिव्हरी उपलब्ध">
                    <i className="fas fa-bicycle"></i>
                    <span>डिलिव्हरी</span>
                </div>
            )}

            <div className="flex justify-between items-start gap-4">
                {/* Left side: Info */}
                <div className="flex-grow min-w-0">
                    <h4 className="text-lg font-bold text-primary pr-16 truncate group-hover:whitespace-normal" title={business.shopName}>{business.shopName}</h4>
                    <div className="mt-2 space-y-1.5 text-text-secondary">
                        <p className="flex items-center gap-3">
                            <i className="fas fa-user w-4 text-center text-gray-400"></i>
                            <span>{business.ownerName}</span>
                        </p>
                        <p className="flex items-center gap-3">
                            <i className="fas fa-phone w-4 text-center text-gray-400"></i>
                            <span className="font-semibold text-text-primary tracking-wider">{formatPhoneNumber(business.contactNumber)}</span>
                        </p>
                    </div>
                </div>

                {/* Right side: Actions */}
                <div className="flex flex-col items-center justify-center gap-2 pt-1 flex-shrink-0">
                    <a 
                        href={`tel:${business.contactNumber}`} 
                        aria-label={`Call ${business.ownerName}`}
                        className="flex items-center justify-center w-9 h-9 bg-primary text-white rounded-full shadow-md transition-all transform hover:scale-110 hover:shadow-lg"
                    >
                        <i className="fas fa-phone text-lg"></i>
                    </a>
                    <button
                        onClick={() => onViewDetails(business)}
                        aria-label="View more details"
                        className="flex items-center justify-center w-9 h-9 bg-gray-200 text-text-secondary rounded-full transition-all transform hover:scale-110 hover:bg-gray-300"
                    >
                        <i className="fas fa-ellipsis text-lg"></i>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BusinessCard;
