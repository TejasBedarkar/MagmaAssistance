import { Link } from 'react-router-dom';
import { Compass } from '@/icons/mfgIcons.js';
import { mfgPath } from '../paths.js';

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Compass className="w-12 h-12 text-steel-300 mb-4" />
      <h2 className="text-xl font-semibold text-steel-800">Page not found</h2>
      <p className="text-sm text-steel-500 mt-1 mb-6">
        The page you're looking for doesn't exist.
      </p>
      <Link to={mfgPath()} className="btn-primary">
        Back to Dashboard
      </Link>
    </div>
  );
}
