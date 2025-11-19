// components/common/UserNamePopup.tsx
import React, { useState, useEffect } from 'react';

interface UserNamePopupProps {
  onSave: (name: string) => void;
  onClose?: () => void; // Optional: For manual close handling
}

const UserNamePopup: React.FC<UserNamePopupProps> = ({ onSave, onClose }) => {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();

    if (!trimmedName) {
      setError('कृपया तुमचे शुभ नाव लिहा');
      return;
    }

    if (trimmedName.length < 2) {
      setError('नाव किमान २ अक्षरांचे असावे');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      await onSave(trimmedName);
    } catch (err) {
      setError('काहीतरी चूक झाली. कृपया पुन्हा प्रयत्न करा.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fadeInUp backdrop-blur-sm">
      <div className="bg-surface rounded-xl shadow-xl w-11/12 max-w-md m-4 p-6">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-primary to-secondary rounded-full mb-4">
            <i className="fas fa-user text-3xl text-white"></i>
          </div>
          <h3 className="font-inter text-2xl font-bold text-primary mb-2">
            🙏 स्वागत आहे!
          </h3>
          <p className="text-text-secondary text-sm">
            तुमचे नाव शेअर करा आणि आमच्या कम्युनिटीचा भाग व्हा
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError('');
              }}
              placeholder="तुमचे नाव (उदा. राहुल पाटील)"
              className="w-full p-3 border-2 border-border-color rounded-lg focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
              disabled={isSubmitting}
              autoFocus
              maxLength={50}
            />
            {error && (
              <p className="text-red-500 text-sm mt-2 flex items-center gap-2">
                <i className="fas fa-exclamation-circle"></i>
                {error}
              </p>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-3 px-4 bg-gradient-to-r from-primary to-secondary text-white font-bold rounded-lg hover:opacity-90 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i>
                  <span>प्रोसेसिंग...</span>
                </>
              ) : (
                <>
                  <i className="fas fa-check"></i>
                  <span>नाव सेव्ह करा</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UserNamePopup;
