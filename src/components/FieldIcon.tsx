import { FieldType } from '../types';
import { AlignLeft, Hash, ChevronDownSquare, Calendar, CheckSquare, User, Link as LinkIcon, HelpCircle, Image as ImageIcon, Sparkles, Tags } from 'lucide-react';
import { cn } from '../lib/utils';

export function FieldIcon({ type, className }: { type: FieldType, className?: string }) {
  const props = { className: cn("w-4 h-4 text-gray-500", className) };
  switch (type) {
    case 'text': return <AlignLeft {...props} />;
    case 'number': return <Hash {...props} />;
    case 'singleSelect': return <ChevronDownSquare {...props} />;
    case 'multiSelect': return <Tags {...props} />;
    case 'date': return <Calendar {...props} />;
    case 'checkbox': return <CheckSquare {...props} />;
    case 'person': return <User {...props} />;
    case 'url': return <LinkIcon {...props} />;
    case 'attachment': return <ImageIcon {...props} />;
    case 'aiText': return <Sparkles {...props} />;
    default: return <HelpCircle {...props} />;
  }
}

