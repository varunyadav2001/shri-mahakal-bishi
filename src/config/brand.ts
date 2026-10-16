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
    primary: string;       // Deep Forest Green
    primaryDark: string;   // Sidebar & Badge Dark Green
    primaryLight: string;  // Header Gradient Green
    accent: string;        // Emerald Accent
    accentLight: string;   // Pastel Green
    background: string;    // Main Canvas Background
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
    MR: 'नारायण भिशी',
    EN: 'Narayan Bhishi',
  },
  shortName: 'Narayan',
  tagline: {
    MR: 'विश्वास आणि पारदर्शकता',
    EN: 'Trust, Security & Prosperity',
  },
  subTagline: {
    MR: 'समृद्धीची नवी वाट',
    EN: 'Financial Growth & Community Trust',
  },
  colors: {
    primary: '#0B5C45',
    primaryDark: '#0F4A3C',
    primaryLight: '#0F7A5C',
    accent: '#2F9E6E',
    accentLight: '#E8F5E9',
    background: '#F4F6F5',
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
    filePrefix: 'Narayan_Bhishi',
    driveFolderName: 'Narayan_Bhishi_Backups',
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
