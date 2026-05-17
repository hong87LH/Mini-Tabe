export type FieldType = 'text' | 'number' | 'singleSelect' | 'multiSelect' | 'date' | 'checkbox' | 'person' | 'url' | 'attachment' | 'aiText' | 'formula' | 'aiImage' | 'rating' | 'aiVideo';

export interface SelectOption {
  id: string;
  name: string;
  color: string; // Tailwind color class or hex
}

export interface Attachment {
  id: string;
  url: string;
  name: string;
  size?: number;
  type?: string;
}

export interface Field {
  id: string;
  name: string;
  type: FieldType;
  color?: string;
  options?: SelectOption[];
  width?: number; // width in pixels
  hidden?: boolean;
  prompt?: string; // For aiText and formula
  refFields?: string[]; // For aiText, formula, aiImage
  aiTextConfig?: {
    modelTemplate?: string;
    sourceImageTemplate?: string;
  };
  aiImageConfig?: {
    count?: number;
    size?: string;
    folderPath?: string;
    resolution?: string;
    ratio?: string;
    filenameTemplate?: string;
    modelTemplate?: string;
    sourceImageTemplate?: string;
    sourceImageFields?: string[]; // Legacy
    isRetouchMode?: boolean;
    saveToSourceFolder?: boolean;
    scaleToSource?: boolean;
  };
  aiVideoConfig?: {
    duration?: string;
    resolution?: string;
    ratio?: string;
    sound?: string;
    mode?: string;
    enhancePrompt?: string;
    offPeak?: string;
    folderPath?: string;
    filenameTemplate?: string;
    modelTemplate?: string;
    sourceImageTemplate?: string;
    sourceVideoTemplate?: string;
    sourceAudioTemplate?: string;
  };
}

export interface BaseRecord {
  id: string;
  [fieldId: string]: any;
}

export interface GridData {
  fields: Field[];
  records: BaseRecord[];
  frozenColId?: string | null;
  cellLinks?: Record<string, string>;
}

