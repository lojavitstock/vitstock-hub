import React from 'react';
import { UserRound } from 'lucide-react';
import { traceAvatarImageError, type AvatarDebugSource } from '../../utils/avatarDiagnostics';

type ContactPhotoProps = {
  name: string;
  avatar?: string;
  size?: 'small' | 'medium' | 'large';
  emphasized?: boolean;
  lazy?: boolean;
  sourceCategory?: AvatarDebugSource;
  onPhotoClick?: (avatar: string) => void;
};

export const ContactPhoto = React.memo<ContactPhotoProps>(({
  name,
  avatar,
  size = 'medium',
  emphasized = false,
  lazy = false,
  sourceCategory,
  onPhotoClick,
}) => {
  const [imageError, setImageError] = React.useState(false);
  const [loadedAvatar, setLoadedAvatar] = React.useState<string | null>(null);
  const sizeClass = size === 'small' ? 'w-8 h-8' : size === 'large' ? 'w-16 h-16' : 'w-11 h-11';
  const iconClass = size === 'small' ? 'w-4 h-4' : size === 'large' ? 'w-7 h-7' : 'w-5 h-5';
  const isClickable = Boolean(onPhotoClick && avatar && loadedAvatar === avatar && !imageError);

  React.useEffect(() => {
    setImageError(false);
    if (onPhotoClick) setLoadedAvatar(null);
  }, [avatar, onPhotoClick]);

  const activatePhoto = () => {
    if (isClickable && avatar) onPhotoClick?.(avatar);
  };

  return (
    <div
      className={`${sizeClass} relative flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full border ${emphasized ? 'border-amber-400/60' : 'border-[#46535a]'} bg-[#2a343a] ${isClickable ? 'cursor-pointer transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300' : ''}`}
      title={isClickable ? `Ampliar foto de ${name}` : name}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-label={isClickable ? `Ampliar foto de ${name}` : undefined}
      onClick={isClickable ? activatePhoto : undefined}
      onKeyDown={isClickable ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activatePhoto();
        }
      } : undefined}
    >
      <UserRound className={`${iconClass} text-slate-400`} />
      {avatar && !imageError && (
        <img
          key={onPhotoClick ? avatar : undefined}
          src={avatar}
          alt=""
          loading={lazy ? 'lazy' : undefined}
          className="absolute inset-0 h-full w-full object-cover"
          onLoad={onPhotoClick ? () => setLoadedAvatar(avatar) : undefined}
          onError={(event) => {
            traceAvatarImageError({
              entityId: name,
              avatar: event.currentTarget.currentSrc || event.currentTarget.src,
              sourceCategory,
            });
            if (onPhotoClick) setLoadedAvatar(null);
            setImageError(true);
          }}
        />
      )}
    </div>
  );
});

ContactPhoto.displayName = 'ContactPhoto';
