import type { UrgencyLevel } from '../bundle.schema.js';

/**
 * Knowledge library for the demo tenant. Each source is a short summary,
 * written for Nora, of a named public page from the NHS, the World Health
 * Organization or India's Ministry of Health; the URL is the page it
 * summarises, and each passage restates only what that page says. The
 * summaries have not been reviewed by a clinician, so they are labelled as
 * summaries rather than as the publisher's own text.
 */
export interface KnowledgeSeed {
  sourceKey: string;
  title: string;
  publisher: string;
  url: string;
  licence: string;
  concernCodes: string[];
  version: string;
  /**
   * `tier` is the care level the page gives for what the passage lists, read
   * as: call an ambulance or go to the emergency department = emergency; an
   * urgent appointment or urgent advice line = urgent; see a doctor
   * (non-urgent) = routine; look after yourself = self_care. It is not stored;
   * tests use it to find rules that ask for less than their source.
   */
  chunks: { heading: string; text: string; tier?: UrgencyLevel }[];
}

const NHS = 'Based on NHS guidance (nhs.uk)';
const WHO = 'Based on World Health Organization guidance (who.int)';
const MOHFW = 'Ministry of Health and Family Welfare, India (Tele-MANAS)';
const SUMMARY = 'Summary written for Nora from the linked public page; not reviewed by a clinician';
const version = '3.0';

const ALL_CONCERNS = ['sore_throat', 'headache', 'urinary', 'cough', 'back_pain', 'abdominal_pain', 'skin_rash', 'ear_pain', 'dizziness', 'cold_flu', 'gastro', 'fever', 'animal_bite'];

export const demoKnowledge: KnowledgeSeed[] = [
  {
    sourceKey: 'src_red_flags',
    title: 'When to go to the emergency department',
    publisher: NHS,
    url: 'https://www.nhs.uk/nhs-services/urgent-and-emergency-care-services/when-to-go-to-ae/',
    licence: SUMMARY,
    concernCodes: ALL_CONCERNS,
    version,
    chunks: [
      {
        heading: 'Getting emergency help',
        text: 'The emergency department (A&E) is for serious injuries and life-threatening emergencies. Do not drive yourself there: ask someone to drive you or call for an ambulance, and bring any medicines you take.',
        tier: 'emergency',
      },
      { heading: 'When you are not sure', text: 'If you are not sure whether you need emergency care, get medical advice straight away so someone can check your symptoms and tell you what to do.', tier: 'urgent' },
    ],
  },
  {
    sourceKey: 'src_sore_throat',
    title: 'Sore throat',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/sore-throat/',
    licence: SUMMARY,
    concernCodes: ['sore_throat'],
    version,
    chunks: [
      {
        heading: 'Common causes',
        text: 'Sore throats are very common and usually nothing to worry about. They normally get better by themselves within a week. They are usually caused by viruses, such as a cold or flu, or by smoking, and very occasionally by bacteria. You do not normally need antibiotics for a sore throat.',
      },
      { heading: 'Self-care', text: 'Gargling with warm, salty water, drinking plenty of water, eating cool or soft foods, avoiding smoking or smoky places, and resting can soothe a sore throat.', tier: 'self_care' },
      {
        heading: 'Same-day care',
        text: 'Get an urgent appointment with a doctor if you have a sore throat and a very high temperature, or you feel hot, cold or shivery; signs of dehydration, such as peeing less than usual or dark, strong-smelling pee; or a weakened immune system, for example because of diabetes or chemotherapy.',
        tier: 'urgent',
      },
      {
        heading: 'Emergency',
        text: 'Get emergency help if you have difficulty breathing or are unable to swallow, are drooling, which can be a sign of not being able to swallow, are making a high-pitched sound as you breathe, or have severe symptoms that are getting worse quickly.',
        tier: 'emergency',
      },
      { heading: 'See a doctor', text: 'See a doctor if your sore throat does not improve after a week, you often get a sore throat, or you have a lump in your mouth or neck or a mouth ulcer that lasts for more than 3 weeks.', tier: 'routine' },
    ],
  },
  {
    sourceKey: 'src_headache',
    title: 'Headaches',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/headaches/',
    licence: SUMMARY,
    concernCodes: ['headache'],
    version,
    chunks: [
      {
        heading: 'Self-care',
        text: 'Most headaches go away on their own and are not a sign of something more serious. It can help to drink plenty of water, rest, try to relax, not skip meals, and not strain your eyes for a long time, for example by looking at a screen.',
        tier: 'self_care',
      },
      {
        heading: 'Common causes',
        text: 'Common causes of headaches include a cold or flu, stress, drinking too much alcohol, bad posture, eyesight problems, not eating regular meals, not drinking enough fluids and taking too many painkillers. Keeping a headache diary might help you work out what triggers your headaches.',
      },
      { heading: 'See a doctor', text: 'See a doctor if you have tried treating a headache yourself and it is not getting better or is getting worse, or if you regularly get headaches.', tier: 'routine' },
      {
        heading: 'Same-day care',
        text: 'Get an urgent appointment with a doctor if you have a headache with vision or eye problems, a headache triggered or made worse by coughing, sneezing, bending down or exercising, a headache and you are being sick (vomiting), or a headache with jaw pain when eating or a sore or tender scalp.',
        tier: 'urgent',
      },
      {
        heading: 'Emergency',
        text: 'Get emergency help if you have a headache and you have had a seizure (fit); have numbness or weakness in the body or face; it started suddenly and is extremely painful; you have had a head injury within the last 3 months; you find it difficult to speak, balance, walk or remember things; you are drowsy or confused; you have loss of vision; you have a rash that does not fade when a glass is rolled over it; or you have a very high temperature, a stiff neck, or bright lights are bothering you.',
        tier: 'emergency',
      },
    ],
  },
  {
    sourceKey: 'src_urinary',
    title: 'Urinary tract infections (UTIs)',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/urinary-tract-infections-utis/',
    licence: SUMMARY,
    concernCodes: ['urinary'],
    version,
    chunks: [
      {
        heading: 'Symptoms',
        text: 'Symptoms of a urinary tract infection can include pain or burning when peeing, needing to pee more often or more urgently than usual, cloudy pee, blood in your pee, lower tummy pain or pain in your back just under the ribs, a high temperature or feeling hot, cold and shivery, and feeling tired or weak.',
      },
      { heading: 'Treatment', text: 'A doctor may do a urine test, offer self-care advice and a painkiller, or give a short course of antibiotics, sometimes after waiting 48 hours to see whether symptoms go away on their own.', tier: 'routine' },
      {
        heading: 'Same-day care',
        text: 'With urinary infection symptoms, get an urgent appointment with a doctor if you are 65 or older, you have a very high or low temperature, feel hot or cold or are shivering, you are a man, you have diabetes or a weakened immune system, your symptoms get worse quickly or do not improve within 48 hours, you keep getting infections, you are pregnant, you have pain in the lower tummy or in the back just under the ribs, or you have blood in your pee.',
        tier: 'urgent',
      },
      { heading: 'Emergency', text: 'Get emergency help if you are confused, drowsy, or have difficulty speaking.', tier: 'emergency' },
      { heading: 'Self-care', text: 'To help ease symptoms, rest and drink enough fluids so you pass pale urine regularly during the day.', tier: 'self_care' },
    ],
  },
  {
    sourceKey: 'src_cough',
    title: 'Cough',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/cough/',
    licence: SUMMARY,
    concernCodes: ['cough'],
    version,
    chunks: [
      { heading: 'Most coughs', text: 'A cough will usually clear up on its own within 3 to 4 weeks. Most coughs are caused by a cold or flu. Antibiotics are not normally prescribed for coughs.' },
      { heading: 'Self-care', text: 'Rest and drink plenty of fluids. Hot lemon and honey may help, although there is limited evidence that it eases a cough.', tier: 'self_care' },
      {
        heading: 'Medicines',
        text: 'Some medicines and herbal treatments are not safe for everyone, for example if you are pregnant. Always check the leaflet or speak to a pharmacist before taking them.',
      },
      {
        heading: 'Same-day care',
        text: 'Get an urgent appointment with a doctor if your cough is very bad or quickly gets worse, you feel very unwell, you have chest pain, the side of your neck feels swollen and painful, you find it hard to breathe, or you are coughing up blood.',
        tier: 'urgent',
      },
      { heading: 'See a doctor', text: 'See a doctor if you have had a cough for more than 3 weeks, you are losing weight for no reason, or you have a weakened immune system, for example because of chemotherapy or diabetes.', tier: 'routine' },
    ],
  },
  {
    sourceKey: 'src_back_pain',
    title: 'Back pain',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/back-pain/',
    licence: SUMMARY,
    concernCodes: ['back_pain'],
    version,
    chunks: [
      { heading: 'Self-care', text: 'Back pain often improves on its own within a few weeks. Stay active and try to continue with your daily activities, and do not stay in bed for long periods of time.', tier: 'self_care' },
      { heading: 'Same-day care', text: 'With back pain, get an urgent appointment with a doctor if you feel hot, cold, shivery or generally unwell, or it is severe pain that starts suddenly or is getting worse quickly.', tier: 'urgent' },
      {
        heading: 'Emergency',
        text: 'With back pain, get emergency help if you have pain, tingling, weakness or numbness in both legs, a loss of feeling around your genitals or bottom, changes in your bladder or bowels such as difficulty peeing or peeing or pooing yourself, chest pain, or if it started after a serious accident.',
        tier: 'emergency',
      },
      {
        heading: 'See a doctor',
        text: 'See a doctor if back pain does not improve after treating it at home for a few weeks, stops you doing your day-to-day activities, does not improve after resting or is worse at night, or you have lost weight without trying.',
        tier: 'routine',
      },
    ],
  },
  {
    sourceKey: 'src_abdominal',
    title: 'Stomach ache',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/stomach-ache/',
    licence: SUMMARY,
    concernCodes: ['abdominal_pain'],
    version,
    chunks: [
      { heading: 'Common causes', text: 'Most stomach aches are not anything serious and will go away after a few days. Common causes include trapped wind, indigestion, constipation, and stomach bugs or food poisoning.' },
      {
        heading: 'Same-day care',
        text: 'With a stomach ache, get an urgent appointment with a doctor if it gets much worse, does not go away or keeps coming back, you have problems swallowing food, you are losing weight without trying, peeing is suddenly painful or more or less often, you bleed from your bottom, or you have diarrhoea that does not go away after a few days.',
        tier: 'urgent',
      },
      {
        heading: 'Emergency',
        text: 'Get emergency help if a stomach ache came on very suddenly or is severe, it hurts when you touch your stomach, you are vomiting blood or your vomit looks like ground coffee, your poo is bloody or black and sticky, you cannot pee, poo or fart, you cannot breathe, you have chest pain, or you have diabetes and you are vomiting.',
        tier: 'emergency',
      },
    ],
  },
  {
    sourceKey: 'src_skin_rash',
    title: 'Hives',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/hives/',
    licence: SUMMARY,
    concernCodes: ['skin_rash'],
    version,
    chunks: [
      { heading: 'Hives', text: 'Hives is an itchy rash of raised bumps or patches that can appear anywhere on the body. It usually gets better within a few days and can often be treated at home; a pharmacist can advise.', tier: 'self_care' },
      {
        heading: 'Triggers',
        text: 'Hives can be triggered by eating certain foods; contact with certain plants, animals, chemicals or latex; cold, heat or sweating; a medicine, insect bite or sting; scratching or pressure on the skin; or an infection. Finding and avoiding your triggers may help prevent it.',
      },
      {
        heading: 'Same-day care',
        text: 'Get an urgent appointment with a doctor if a hives rash does not improve after 2 days, the rash is spreading, it keeps coming back, you also have a high temperature and feel unwell, or you also have swelling under your skin.',
        tier: 'urgent',
      },
      {
        heading: 'Emergency',
        text: 'Get emergency help if your lips, mouth, throat or tongue suddenly become swollen, you are breathing very fast or struggling to breathe, your throat feels tight or you are struggling to swallow, your skin, tongue or lips turn blue, grey or pale, or you suddenly become very confused, drowsy or dizzy. These can be signs of a serious allergic reaction.',
        tier: 'emergency',
      },
    ],
  },
  {
    sourceKey: 'src_ear_pain',
    title: 'Earache',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/earache/',
    licence: SUMMARY,
    concernCodes: ['ear_pain'],
    version,
    chunks: [
      {
        heading: 'Self-care',
        text: 'Earache is not usually a sign of anything serious and most earaches get better on their own. A warm flannel on the ear may help. Do not put anything inside your ear, such as cotton buds, and do not let water get inside it. A pharmacist can advise.',
        tier: 'self_care',
      },
      {
        heading: 'Same-day care',
        text: 'With earache, get an urgent appointment with a doctor if you have had it for more than 2 to 3 days, you become generally unwell, you have a very high temperature or feel hot, cold or shivery, you have swelling around the ear, fluid is coming from the ear, you have hearing loss or a change in hearing, or something is stuck in the ear.',
        tier: 'urgent',
      },
    ],
  },
  {
    sourceKey: 'src_hearing_loss',
    title: 'Hearing loss',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/hearing-loss/',
    licence: SUMMARY,
    concernCodes: ['ear_pain', 'dizziness'],
    version,
    chunks: [
      {
        heading: 'Same-day care',
        text: 'Get an urgent appointment with a doctor if you have sudden hearing loss in one or both ears, your hearing has been getting worse over the last few days or weeks, or you have hearing loss along with other symptoms such as earache or discharge from the ear. It may need to be treated quickly.',
        tier: 'urgent',
      },
      { heading: 'See a doctor', text: 'See a doctor if you think your hearing is getting gradually worse, or your hearing has not come back after treatment for an ear infection or earwax.', tier: 'routine' },
    ],
  },
  {
    sourceKey: 'src_dizziness',
    title: 'Dizziness',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/dizziness/',
    licence: SUMMARY,
    concernCodes: ['dizziness'],
    version,
    chunks: [
      {
        heading: 'Self-care',
        text: 'Dizziness is not usually serious and usually goes away on its own. Lie down until it passes, then get up slowly; rest and drink plenty of fluids. Do not do anything that could be dangerous while you are dizzy, like driving, climbing a ladder or using heavy machinery.',
        tier: 'self_care',
      },
      {
        heading: 'Causes',
        text: 'Dizziness when standing or sitting up suddenly can come from a sudden drop in blood pressure. Feeling off-balance or like things are spinning, sometimes with feeling sick and after a cold or flu, can come from the inner ear. Dizziness can also follow dehydration, an ear infection or migraine.',
      },
      {
        heading: 'See a doctor',
        text: 'See a doctor if you are worried about dizziness, it will not go away or keeps coming back, you are finding it harder to hear or speak, you have ringing in your ears, you have changes in your eyesight, your face, arms or legs feel numb or weak, or you have other symptoms such as fainting, headaches or being sick.',
        tier: 'routine',
      },
    ],
  },
  {
    sourceKey: 'src_cold_flu',
    title: 'Flu',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/flu/',
    licence: SUMMARY,
    concernCodes: ['cold_flu', 'fever'],
    version,
    chunks: [
      {
        heading: 'Flu symptoms',
        text: 'Flu will often get better on its own, but it can make some people seriously ill. Its symptoms come on very quickly and can include a sudden high temperature, an aching body, feeling tired or exhausted, a dry cough, a sore throat, a headache, difficulty sleeping and loss of appetite.',
      },
      {
        heading: 'Colds and flu',
        text: 'Cold symptoms come on gradually, mainly affect the nose and throat, and you usually still feel well enough for your normal activities. Flu comes on within a few hours and makes you feel too unwell to carry on as normal. Antibiotics do not work for viral infections such as flu.',
      },
      { heading: 'Self-care', text: 'With flu, rest and sleep, and drink plenty of water to avoid dehydration so your pee is light yellow or clear. A pharmacist can give treatment advice.', tier: 'self_care' },
      {
        heading: 'Same-day care',
        text: 'With flu symptoms, get an urgent appointment with a doctor if you are 65 or over, are pregnant, have a long-term condition such as diabetes or a condition affecting your heart, lungs, liver, kidneys, brain or nerves, have a weakened immune system, for example because of chemotherapy or HIV, feel very unwell, feel short of breath, or your symptoms do not improve after 7 days.',
        tier: 'urgent',
      },
      { heading: 'Emergency', text: 'Get emergency help if you get sudden chest pain, have severe difficulty breathing, such as gasping, choking or not being able to get words out, or start coughing up blood.', tier: 'emergency' },
    ],
  },
  {
    sourceKey: 'src_gastro',
    title: 'Diarrhoea and vomiting',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/diarrhoea-and-vomiting/',
    licence: SUMMARY,
    concernCodes: ['gastro', 'abdominal_pain'],
    version,
    chunks: [
      {
        heading: 'Stomach bugs and food poisoning',
        text: 'Diarrhoea and vomiting are often caused by a stomach bug and can usually be treated at home. In adults, diarrhoea usually stops within 5 to 7 days and vomiting in 1 or 2 days.',
      },
      {
        heading: 'Rehydration',
        text: 'The most important thing is to drink lots of fluids, such as water, to avoid dehydration, taking small sips if you feel sick. A pharmacist can recommend oral rehydration powder that you mix with water. Eat when you feel able to.',
        tier: 'self_care',
      },
      {
        heading: 'Same-day care',
        text: 'Get urgent medical advice if you keep being sick and cannot keep fluid down, still have signs of dehydration after using oral rehydration sachets, have bloody diarrhoea or bleeding from your bottom, or have diarrhoea for more than 7 days or vomiting for more than 2 days.',
        tier: 'urgent',
      },
      {
        heading: 'Emergency',
        text: 'Get emergency help if you vomit blood or have vomit that looks like ground coffee, have green vomit, have a stiff neck and pain when looking at bright lights, have a sudden, severe headache or tummy ache, are having severe difficulty breathing, or are confused or not responding as usual.',
        tier: 'emergency',
      },
    ],
  },
  {
    sourceKey: 'src_self_care_general',
    title: 'High temperature (fever) in adults',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/fever-in-adults/',
    licence: SUMMARY,
    concernCodes: ALL_CONCERNS,
    version,
    chunks: [
      {
        heading: 'What counts as a high temperature',
        text: 'A high temperature is usually 38C or above. If you feel hot, cold or shivery, you may have a high temperature even if a thermometer says it is below 38C. You do not need a thermometer, but you can use one if you have it.',
      },
      {
        heading: 'Rest and fluids',
        text: 'Get lots of rest and drink plenty of fluids, water is best, so your pee is light yellow and clear. Try to stay at home and avoid contact with other people until you no longer have a high temperature.',
        tier: 'self_care',
      },
      { heading: 'When to get help', text: 'Get an urgent appointment with a doctor if you have a high temperature and have been treating it at home but it is not getting better or is getting worse.', tier: 'urgent' },
      {
        heading: 'Causes',
        text: 'Many things can cause a high temperature. It is not usually a sign of anything serious and is often caused by your body fighting an infection, such as a cold or flu. Sometimes it can be a sign of something more serious if your temperature is very high or will not come down.',
      },
    ],
  },
  {
    sourceKey: 'src_fever',
    title: 'Dengue and severe dengue',
    publisher: WHO,
    url: 'https://www.who.int/news-room/fact-sheets/detail/dengue-and-severe-dengue',
    licence: SUMMARY,
    // About one disease, so it is not evidence for a fever in general; kept so earlier results can still show what they cited.
    concernCodes: [],
    version,
    chunks: [
      {
        heading: 'Symptoms',
        text: 'Most people with dengue have mild or no symptoms and get better in 1 to 2 weeks. When symptoms occur they usually begin 4 to 10 days after infection and last 2 to 7 days; common symptoms are high fever, headache, body aches, nausea and rash.',
      },
      {
        heading: 'Severe dengue',
        text: 'Symptoms of severe dengue often come after the fever has gone away and may include severe abdominal pain, persistent vomiting, rapid breathing, bleeding gums or nose, fatigue, restlessness, blood in vomit or stool, being very thirsty, pale and cold skin, and feeling weak. People with these severe symptoms should seek care immediately.',
        tier: 'emergency',
      },
    ],
  },
  {
    sourceKey: 'src_chest_pain',
    title: 'Chest pain',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/chest-pain/',
    licence: SUMMARY,
    concernCodes: ALL_CONCERNS,
    version,
    chunks: [
      {
        heading: 'Emergency',
        text: 'Get emergency help if you get sudden pain or discomfort in your chest that does not go away, which can feel like squeezing, pressure, burning or indigestion; pain that spreads to your arm, neck, jaw, stomach or back; or chest pain with feeling sweaty, sick, light headed or short of breath.',
        tier: 'emergency',
      },
      { heading: 'See a doctor', text: 'See a doctor if you have chest pain that comes and goes, or chest pain that goes away quickly but you are still worried.', tier: 'routine' },
    ],
  },
  {
    sourceKey: 'src_breathing',
    title: 'Shortness of breath',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/shortness-of-breath/',
    licence: SUMMARY,
    concernCodes: ALL_CONCERNS,
    version,
    chunks: [
      {
        heading: 'Emergency',
        text: 'Get emergency help if you have severe difficulty breathing, such as gasping, choking or not being able to get words out; your chest feels tight or heavy; you have pain that spreads to your arms, back, neck and jaw; your lips or skin are turning very pale, blue or grey; or you feel suddenly confused.',
        tier: 'emergency',
      },
      {
        heading: 'Same-day care',
        text: 'Get urgent medical advice if you have difficulty breathing or are more short of breath than usual, feel or are being sick, are coughing up blood, have pain or swelling in one of your legs, or have heart palpitations, such as your heart racing, skipping a beat or fluttering.',
        tier: 'urgent',
      },
    ],
  },
  {
    sourceKey: 'src_stroke',
    title: 'Symptoms of a stroke',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/stroke/symptoms/',
    licence: SUMMARY,
    concernCodes: ALL_CONCERNS,
    version,
    chunks: [
      {
        heading: 'Signs of a stroke',
        text: 'The main signs of a stroke can happen suddenly: one side of the face may droop, you may not be able to lift both arms because of weakness or numbness in one arm, and you may slur your words. Call for emergency help straight away if you think you are having a stroke or have had signs of one in the last 24 hours, even if they have stopped.',
        tier: 'emergency',
      },
      {
        heading: 'Other signs',
        text: 'Other signs of a stroke include weakness or numbness down one side of the body, blurred vision or loss of sight in one or both eyes, difficulty speaking or thinking of words, confusion and memory loss, feeling dizzy or falling over, a severe headache, and feeling or being sick.',
        tier: 'emergency',
      },
    ],
  },
  {
    sourceKey: 'src_anaphylaxis',
    title: 'Anaphylaxis',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/anaphylaxis/',
    licence: SUMMARY,
    concernCodes: ALL_CONCERNS,
    version,
    chunks: [
      {
        heading: 'Emergency',
        text: 'Anaphylaxis is a life-threatening allergic reaction that happens very quickly. Get emergency help if your lips, mouth, throat or tongue suddenly become swollen, you are breathing very fast or struggling to breathe, your throat feels tight or you are struggling to swallow, or your skin, tongue or lips turn blue, grey or pale.',
        tier: 'emergency',
      },
    ],
  },
  {
    sourceKey: 'src_meningitis',
    title: 'Meningitis',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/meningitis/',
    licence: SUMMARY,
    concernCodes: ALL_CONCERNS,
    version,
    chunks: [
      {
        heading: 'Get help immediately',
        text: 'Meningitis can be life-threatening. Get emergency help if an adult has a very painful headache; is confused, has slurred speech or is not making sense; has a stiff neck and cannot look at bright lights; has a rash that does not fade when you press it; has a seizure for the first time; or has a very high or very low temperature or is shivery with symptoms you are worried might be meningitis.',
        tier: 'emergency',
      },
    ],
  },
  {
    sourceKey: 'src_sepsis',
    title: 'Sepsis',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/sepsis/',
    licence: SUMMARY,
    concernCodes: ALL_CONCERNS,
    version,
    chunks: [
      {
        heading: 'Get help immediately',
        text: 'Sepsis is a serious reaction to an infection. Get emergency help if an adult is breathing very fast; is confused, has slurred speech or is not making sense; has blue, pale or blotchy skin; has a rash that does not fade when you press it; or has a very high or very low temperature or is shivery with symptoms you are worried might be sepsis.',
        tier: 'emergency',
      },
      {
        heading: 'Higher risk',
        text: 'Anyone can get sepsis, but the chance is higher if you are over 75, are pregnant or have recently given birth, have a weakened immune system, for example from chemotherapy or medicines such as steroids, or have a wound or skin infection.',
      },
    ],
  },
  {
    sourceKey: 'src_chemotherapy',
    title: 'Chemotherapy',
    publisher: NHS,
    url: 'https://www.nhs.uk/tests-and-treatments/chemotherapy/',
    licence: SUMMARY,
    concernCodes: ALL_CONCERNS,
    version,
    chunks: [
      {
        heading: 'Infection warning signs',
        text: 'Chemotherapy can weaken the immune system, so infections can happen more easily. Contact your care team now if you have a high temperature, such as feeling hot, cold, sweaty or shivery, or other signs of an infection such as a sore throat, cough, diarrhoea, or pain when peeing.',
        tier: 'urgent',
      },
    ],
  },
  {
    sourceKey: 'src_rabies',
    title: 'Rabies',
    publisher: WHO,
    url: 'https://www.who.int/news-room/fact-sheets/detail/rabies',
    licence: SUMMARY,
    concernCodes: ['animal_bite'],
    version,
    chunks: [
      {
        heading: 'How rabies spreads',
        text: 'Rabies spreads to people through the saliva of infected animals, usually through bites, scratches or contact with the eyes, mouth or open wounds. Dogs cause up to 99% of human cases; bites from rodents are not known to transmit rabies. Once symptoms appear, rabies is almost always fatal, but deaths are preventable with prompt care after a bite or scratch, including thorough wound washing and a course of rabies vaccine.',
      },
      {
        heading: 'First aid',
        text: 'If you are bitten or scratched by an animal that could have rabies, wash the wound straight away with soap and water for at least 15 minutes and seek medical attention.',
        tier: 'urgent',
      },
    ],
  },
  {
    sourceKey: 'src_animal_bites',
    title: 'Animal and human bites',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/animal-and-human-bites/',
    licence: SUMMARY,
    concernCodes: ['animal_bite'],
    version,
    chunks: [
      {
        heading: 'Care after a bite',
        text: 'Clean the wound with soap and warm water, gently squeeze it so it bleeds slightly unless it is already bleeding, and press a clean cloth firmly on it if it is bleeding heavily. Then pat it dry and cover it with a clean dressing.',
      },
      {
        heading: 'Same-day care',
        text: 'Get urgent medical advice if you have been bitten and there may be teeth, hair or dirt in the wound, the bite is hot or swollen, you have a high temperature or feel hot, cold or shivery, fluid is leaking from the bite, it smells unpleasant, the bite is on your hands, feet, face or head, or you were bitten by a person.',
        tier: 'urgent',
      },
      { heading: 'Emergency', text: 'Go to the emergency department if you have been bitten and the wound is large or deep, or you cannot stop the bleeding.', tier: 'emergency' },
    ],
  },
  {
    sourceKey: 'src_snakebite',
    title: 'Snake bites',
    publisher: NHS,
    url: 'https://www.nhs.uk/conditions/snake-bites/',
    licence: SUMMARY,
    concernCodes: ['animal_bite'],
    version,
    chunks: [
      { heading: 'Emergency care', text: 'Get emergency help straight away if you think you have been bitten by a snake. Do not drive yourself: ask someone to drive you or call for an ambulance.', tier: 'emergency' },
      {
        heading: 'First aid',
        text: 'While you wait for help, stay calm, keep the bitten part of your body as still as you can, and take off jewellery and loosen clothes near the bite in case it swells. Do not try to suck or cut the venom out of the bite, and do not tie anything tightly around it.',
      },
    ],
  },
  {
    sourceKey: 'src_mental_health_crisis',
    title: 'Getting help in a mental health crisis (India)',
    publisher: MOHFW,
    url: 'https://telemanas.mohfw.gov.in/',
    licence: 'Contact details from the official Tele-MANAS website',
    concernCodes: [],
    version,
    chunks: [
      { heading: 'Immediate support', text: 'Tele-MANAS (14416 or 1-800-891-4416) offers free, confidential mental health support 24 hours a day in multiple Indian languages. If you are in immediate danger, call 112.', tier: 'emergency' },
    ],
  },
];
