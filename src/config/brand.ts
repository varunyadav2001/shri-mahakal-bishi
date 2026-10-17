/**
 * ==============================================================================
 * NARAYAN BHISHI - CENTRAL BRAND CONFIGURATION
 * ==============================================================================
 * All brand values (names, taglines, colors, assets, backup prefixes)
 * are maintained in this single file so they can be changed in one place.
 * ==============================================================================
 */

export interface BrandConfig {
  name: {
    MR: string;
    EN: string;
  };
  shortName: string;
  tagline: {
    MR: string;
    EN: string;
  };
  subTagline?: {
    MR: string;
    EN: string;
  };
  colors: {
    primary: string;       // Deep Royal Navy Blue
    primaryDark: string;   // Slate 900
    primaryLight: string;  // Vibrant Blue 600
    accent: string;        // Cyan 500
    accentLight: string;   // Soft Blue Tint
    background: string;    // Main Canvas Background (Slate 50)
    surface: string;       // Card Surface
  };
  assets: {
    logoSvg: string;
    logoPng?: string;
    faviconSvg: string;
    faviconPng?: string;
    manifest: string;
  };
  backup: {
    filePrefix: string;       // e.g. Narayan_Bhishi
    driveFolderName: string;  // e.g. Narayan_Bhishi_Backups
    maxRollingFiles: number;  // 10 files
  };
  defaults: {
    currencySymbol: string;
    currencyCode: string;
    timezone: string;
    defaultLanguage: 'MR' | 'EN';
    offices: Array<{ id: 'MAIN' | 'HOME'; nameMR: string; nameEN: string }>;
  };
}

export const brandConfig: BrandConfig = {
  name: {
    MR: 'श्री महाकाल फायनान्स',
    EN: 'Shri Mahakal Finance',
  },
  shortName: 'Mahakal',
  tagline: {
    MR: 'विश्वास, सुरक्षितता आणि समृद्धी',
    EN: 'Trust, Security & Prosperity',
  },
  subTagline: {
    MR: 'डिजिटल भिशी व्यवस्थापन प्रणाली',
    EN: 'Digital Bhishi Management Platform',
  },
  colors: {
    primary: '#1E3A8A',       // Deep Royal Navy Blue (#1E3A8A)
    primaryDark: '#0F172A',   // Slate 900 (#0F172A)
    primaryLight: '#2563EB',  // Vibrant Blue 600 (#2563EB)
    accent: '#06B6D4',        // Cyan 500 (#06B6D4)
    accentLight: '#EFF6FF',   // Soft Blue Tint (#EFF6FF)
    background: '#F8FAFC',    // Slate 50 (#F8FAFC)
    surface: '#FFFFFF',
  },
  assets: {
    logoSvg: '/logo.svg',
    logoPng: '/logo.png',
    faviconSvg: '/favicon.svg',
    faviconPng: '/favicon.png',
    manifest: '/manifest.json',
  },
  backup: {
    filePrefix: 'Shri_Mahakal_Finance',
    driveFolderName: 'Shri_Mahakal_Finance_Backups',
    maxRollingFiles: 10,
  },
  defaults: {
    currencySymbol: '₹',
    currencyCode: 'INR',
    timezone: 'Asia/Kolkata',
    defaultLanguage: 'MR',
    offices: [
      { id: 'MAIN', nameMR: 'मुख्य कार्यालय', nameEN: 'Main Office' },
      { id: 'HOME', nameMR: 'गृह कार्यालय', nameEN: 'Home Office' },
    ],
  },
};

export const getBrandName = (lang: 'MR' | 'EN' = 'MR'): string => {
  return brandConfig.name[lang] || brandConfig.name.MR;
};

export const getBrandTagline = (lang: 'MR' | 'EN' = 'MR'): string => {
  return brandConfig.tagline[lang] || brandConfig.tagline.MR;
};

export const BRAND = {
  ...brandConfig,
  name: brandConfig.name.EN,
  nameMr: brandConfig.name.MR,
};
