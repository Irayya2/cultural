// api/seed-teams.js
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// Load env
const dotenvPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(dotenvPath)) {
  require('dotenv').config({ path: dotenvPath });
}

const { supabase } = require('./db');

async function seed() {
  console.log('Seeding 48 teams into database...');

  for (let i = 1; i <= 48; i++) {
    const paddedNum = String(i).padStart(3, '0');
    const teamName = `Team ${i}`;
    const canonicalEmail = `TEAM ${i}`;
    const password = `Team@${paddedNum}`;
    const passwordHash = await bcrypt.hash(password, 10);
    const uucmsNo = `1::${passwordHash}`;

    // Check if team exists by team_number, email, or canonical name
    const { data: existing } = await supabase
      .from('students')
      .select('*')
      .or(`team_number.eq.${i},email.eq."${canonicalEmail}",email.eq."TEAM${i}",email.eq."TEAM 0${i}",email.eq."TEAM${paddedNum}"`)
      .limit(1);

    const payload = {
      team_number: i,
      team_name: teamName,
      email: canonicalEmail,
      password_hash: passwordHash,
      uucms_no: uucmsNo,
      semester: 1,
      created_at: new Date().toISOString()
    };

    if (!existing || existing.length === 0) {
      const id = uuidv4();
      let { error } = await supabase.from('students').insert({ id, ...payload });

      if (error && error.message.includes('column')) {
        // Fallback: insert only the guaranteed columns
        const fallbackPayload = {
          id,
          team_number: i,
          team_name: teamName,
          email: canonicalEmail,
          password_hash: passwordHash,
          uucms_no: uucmsNo,
          semester: 1,
          created_at: new Date().toISOString()
        };
        const res = await supabase.from('students').insert(fallbackPayload);
        error = res.error;
      }

      if (error) {
        console.error(`Failed to insert ${teamName}:`, error.message);
      } else {
        console.log(`✓ Inserted ${teamName} (Password: ${password})`);
      }
    } else {
      const studentId = existing[0].id;
      let { error } = await supabase
        .from('students')
        .update(payload)
        .eq('id', studentId);

      if (error && error.message.includes('column')) {
        const fallbackUpdate = {
          team_number: i,
          team_name: teamName,
          email: canonicalEmail,
          password_hash: passwordHash,
          uucms_no: uucmsNo,
          semester: 1
        };
        const res = await supabase.from('students').update(fallbackUpdate).eq('id', studentId);
        error = res.error;
      }

      if (error) {
        console.error(`Failed to update ${teamName}:`, error.message);
      } else {
        console.log(`✓ Updated ${teamName} (Password: ${password})`);
      }
    }
  }

  console.log('Finished seeding 48 teams successfully!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
