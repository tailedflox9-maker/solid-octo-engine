export interface Category {
  id: string;
  name: string;
  icon: string;
}

export interface Business {
  id: string;
  category: string;
  shopName: string;
  ownerName: string;
  contactNumber: string;
  address?: string;
  openingHours?: string;
  services?: string[];
  homeDelivery?: boolean;
  paymentOptions?: string[];
}

export interface BusinessData {
  categories: Category[];
  businesses: Business[];
}