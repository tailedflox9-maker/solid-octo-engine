import React from 'react';
import { Category } from '../types';

interface CategoryItemProps {
    name: string;
    icon: string;
    count: number;
    isSelected: boolean;
    onClick: () => void;
    delay: number;
}

const CategoryItem: React.FC<CategoryItemProps> = ({ name, icon, count, isSelected, onClick, delay }) => {
    const baseClasses = "flex flex-col items-center justify-center p-3 rounded-xl cursor-pointer transition-all duration-300 transform text-center group bg-surface shadow-card border-l-4";
    
    const unselectedClasses = "border-transparent hover:shadow-card-hover hover:scale-105";
    const selectedClasses = "border-primary shadow-inner bg-green-50 scale-105";

    const itemClasses = `${baseClasses} ${isSelected ? selectedClasses : unselectedClasses}`;

    return (
        <div
            className={`${itemClasses} animate-fadeInUp`}
            style={{ animationDelay: `${delay}ms`}}
            onClick={onClick}
            role="button"
            tabIndex={0}
            onKeyPress={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
        >
            <i className={`${icon} text-4xl mb-3 text-primary transition-transform duration-500 group-hover:rotate-[360deg]`}></i>
            <span className={`font-semibold text-sm leading-tight text-text-primary`}>{name}</span>
            <span className={`text-xs mt-1 ${isSelected ? 'text-primary/80' : 'text-text-secondary'}`}>({count})</span>
        </div>
    );
};

interface CategoryGridProps {
    categories: Category[];
    businessCounts: Record<string, number>;
    selectedCategory: string | null;
    onCategorySelect: (id: string | null) => void;
}

const CategoryGrid: React.FC<CategoryGridProps> = ({ categories, businessCounts, selectedCategory, onCategorySelect }) => {
    const allCategoriesCount = React.useMemo(() => 
        Object.values(businessCounts).reduce((sum: number, count: number) => sum + count, 0), 
    [businessCounts]);

    return (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4 animate-fadeInUp" style={{ animationDelay: '200ms' }}>
            <CategoryItem
                name="सर्व श्रेण्या"
                icon="fas fa-th-large"
                count={allCategoriesCount}
                isSelected={selectedCategory === null}
                onClick={() => onCategorySelect(null)}
                delay={0}
            />
            {categories.map((category, index) => (
                <CategoryItem
                    key={category.id}
                    name={category.name}
                    icon={category.icon}
                    count={businessCounts[category.id] || 0}
                    isSelected={selectedCategory === category.id}
                    onClick={() => onCategorySelect(category.id)}
                    delay={(index + 1) * 25}
                />
            ))}
        </div>
    );
};

export default CategoryGrid;
