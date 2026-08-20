import React from 'react';
import { UserRound } from 'lucide-react';

type ContactPhotoProps = {
  name: string;
  avatar?: string;
  size?: 'small' | 'medium' | 'large';
  emphasized?: boolean;
  lazy?: boolean;
};

export const ContactPhoto = React.memo<ContactPhotoProps>(({
  name,
  avatar,
  size = 'medium',
  emphasized = false,
  lazy = false,
}) => {
  const sizeClass = size === 'small' ? 'w-8 h-8' : size === 'large' ? 'w-16 h-16' : 'w-11 h-11';
  const iconClass = size === 'small' ? 'w-4 h-4' : size === 'large' ? 'w-7 h-7' : 'w-5 h-5';

  return (
    <div
      className={`${sizeClass} relative flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full border ${emphasized ? 'border-amber-400/60' : 'border-[#46535a]'} bg-[#2a343a]`}
      title={name}
    >
      <UserRound className={`${iconClass} text-slate-400`} />
      {avatar && (
        <img
          src={avatar}
          alt=""
          loading={lazy ? 'lazy' : undefined}
          className="absolute inset-0 h-full w-full object-cover"
          onError={(event) => { event.currentTarget.style.display = 'none'; }}
        />
      )}
    </div>
  );
});

ContactPhoto.displayName = 'ContactPhoto';
