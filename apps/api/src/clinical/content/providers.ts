/** SYNTHETIC provider directory — fictional clinicians and clinics. */
export interface ProviderSeed {
  externalRef: string;
  name: string;
  specialty: string;
  qualifications: string;
  languages: string[];
  modes: ('in_person' | 'video')[];
  feeMinor: number;
  clinicRef: string;
  bookingMethod: 'url' | 'phone';
  nextAvailableInHours: number | null;
  acceptingNew: boolean;
}

export interface ClinicSeed {
  externalRef: string;
  name: string;
  address: string;
  city: string;
  postcode: string;
  lat: number;
  lng: number;
  phone: string;
  accessibility: string[];
}

export const demoClinics: ClinicSeed[] = [
  { externalRef: 'clinic-blr-indiranagar', name: 'Indiranagar Family Clinic', address: '12, 100 Feet Road, Indiranagar', city: 'Bengaluru', postcode: '560038', lat: 12.9719, lng: 77.6412, phone: '+91 80 4000 1001', accessibility: ['wheelchair_access', 'lift'] },
  { externalRef: 'clinic-blr-koramangala', name: 'Koramangala Health Centre', address: '45, 5th Block, Koramangala', city: 'Bengaluru', postcode: '560095', lat: 12.9352, lng: 77.6245, phone: '+91 80 4000 1002', accessibility: ['wheelchair_access'] },
  { externalRef: 'clinic-blr-whitefield', name: 'Whitefield Multispeciality', address: '3, ITPL Main Road, Whitefield', city: 'Bengaluru', postcode: '560066', lat: 12.9698, lng: 77.75, phone: '+91 80 4000 1003', accessibility: ['wheelchair_access', 'lift', 'accessible_toilet'] },
  { externalRef: 'clinic-mum-andheri', name: 'Andheri West Clinic', address: '8, Lokhandwala Complex, Andheri West', city: 'Mumbai', postcode: '400053', lat: 19.1364, lng: 72.8296, phone: '+91 22 4000 2001', accessibility: ['lift'] },
  { externalRef: 'clinic-mum-bandra', name: 'Bandra Care Clinic', address: '22, Hill Road, Bandra West', city: 'Mumbai', postcode: '400050', lat: 19.0544, lng: 72.8406, phone: '+91 22 4000 2002', accessibility: ['wheelchair_access'] },
  { externalRef: 'clinic-del-saket', name: 'Saket Medical Centre', address: '5, Press Enclave Marg, Saket', city: 'New Delhi', postcode: '110017', lat: 28.5245, lng: 77.2066, phone: '+91 11 4000 3001', accessibility: ['wheelchair_access', 'lift'] },
  { externalRef: 'clinic-del-dwarka', name: 'Dwarka Family Health', address: '17, Sector 10, Dwarka', city: 'New Delhi', postcode: '110075', lat: 28.5823, lng: 77.0500, phone: '+91 11 4000 3002', accessibility: [] },
  { externalRef: 'clinic-online', name: 'Nora Demo Teleconsult', address: 'Online', city: 'Online', postcode: '', lat: 0, lng: 0, phone: '+91 80 4000 9000', accessibility: ['remote'] },
];

const p = (
  ref: string,
  name: string,
  specialty: string,
  qualifications: string,
  clinicRef: string,
  languages: string[],
  modes: ProviderSeed['modes'],
  fee: number,
  next: number | null,
  bookingMethod: ProviderSeed['bookingMethod'] = 'url',
  acceptingNew = true,
): ProviderSeed => ({
  externalRef: ref,
  name,
  specialty,
  qualifications,
  clinicRef,
  languages,
  modes,
  feeMinor: fee * 100,
  bookingMethod,
  nextAvailableInHours: next,
  acceptingNew,
});

export const demoProviders: ProviderSeed[] = [
  p('dr-ananya-rao', 'Dr. Ananya Rao', 'General Physician', 'MBBS, MD (General Medicine)', 'clinic-blr-indiranagar', ['English', 'Kannada', 'Hindi'], ['in_person', 'video'], 600, 4),
  p('dr-vikram-shetty', 'Dr. Vikram Shetty', 'General Physician', 'MBBS, DNB (Family Medicine)', 'clinic-blr-koramangala', ['English', 'Kannada', 'Tulu'], ['in_person'], 500, 20),
  p('dr-farah-khan', 'Dr. Farah Khan', 'General Physician', 'MBBS, MD (Internal Medicine)', 'clinic-mum-andheri', ['English', 'Hindi', 'Urdu', 'Marathi'], ['in_person', 'video'], 800, 6),
  p('dr-rohit-malhotra', 'Dr. Rohit Malhotra', 'General Physician', 'MBBS', 'clinic-del-dwarka', ['English', 'Hindi', 'Punjabi'], ['in_person'], 400, 30, 'phone'),
  p('dr-meera-iyer', 'Dr. Meera Iyer', 'General Physician', 'MBBS, MD (Family Medicine)', 'clinic-online', ['English', 'Tamil', 'Hindi'], ['video'], 350, 1),
  p('dr-suresh-nair', 'Dr. Suresh Nair', 'ENT', 'MBBS, MS (ENT)', 'clinic-blr-whitefield', ['English', 'Malayalam', 'Hindi'], ['in_person'], 900, 48),
  p('dr-kavita-desai', 'Dr. Kavita Desai', 'ENT', 'MBBS, DLO', 'clinic-mum-bandra', ['English', 'Gujarati', 'Hindi', 'Marathi'], ['in_person', 'video'], 1000, 26),
  p('dr-arjun-menon', 'Dr. Arjun Menon', 'Neurologist', 'MBBS, MD, DM (Neurology)', 'clinic-blr-whitefield', ['English', 'Malayalam'], ['in_person'], 1500, 72),
  p('dr-priya-sharma', 'Dr. Priya Sharma', 'Neurologist', 'MBBS, MD, DM (Neurology)', 'clinic-del-saket', ['English', 'Hindi'], ['in_person', 'video'], 1800, 96),
  p('dr-sanjay-gupta', 'Dr. Sanjay Gupta', 'Urologist', 'MBBS, MS, MCh (Urology)', 'clinic-del-saket', ['English', 'Hindi'], ['in_person'], 1200, 50),
  p('dr-lakshmi-reddy', 'Dr. Lakshmi Reddy', 'Urologist', 'MBBS, MS, MCh (Urology)', 'clinic-blr-indiranagar', ['English', 'Telugu', 'Kannada'], ['in_person'], 1100, 30),
  p('dr-nikhil-joshi', 'Dr. Nikhil Joshi', 'Pulmonologist', 'MBBS, MD (Respiratory Medicine)', 'clinic-mum-andheri', ['English', 'Marathi', 'Hindi'], ['in_person', 'video'], 1200, 24),
  p('dr-asha-pillai', 'Dr. Asha Pillai', 'Pulmonologist', 'MBBS, DNB (Respiratory Medicine)', 'clinic-blr-koramangala', ['English', 'Malayalam', 'Kannada'], ['in_person'], 1000, 40),
  p('dr-rahul-verma', 'Dr. Rahul Verma', 'Orthopaedics', 'MBBS, MS (Orthopaedics)', 'clinic-del-dwarka', ['English', 'Hindi'], ['in_person'], 900, 20),
  p('dr-divya-krishnan', 'Dr. Divya Krishnan', 'Orthopaedics', 'MBBS, MS (Orthopaedics)', 'clinic-blr-indiranagar', ['English', 'Tamil', 'Kannada'], ['in_person', 'video'], 1000, 12),
  p('dr-imran-sheikh', 'Dr. Imran Sheikh', 'Gastroenterologist', 'MBBS, MD, DM (Gastroenterology)', 'clinic-mum-bandra', ['English', 'Hindi', 'Urdu'], ['in_person'], 1600, 60),
  p('dr-neha-agarwal', 'Dr. Neha Agarwal', 'Gastroenterologist', 'MBBS, MD, DM (Gastroenterology)', 'clinic-del-saket', ['English', 'Hindi'], ['in_person', 'video'], 1500, null, 'phone', false),
  p('dr-george-thomas', 'Dr. George Thomas', 'Emergency Medicine', 'MBBS, MEM', 'clinic-blr-whitefield', ['English', 'Malayalam', 'Hindi'], ['in_person'], 0, 0, 'phone'),
];
