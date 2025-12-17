import sql from "../config/db.js";

/**
 * Update streak pengguna berdasarkan aktivitas harian
 * Aktivitas yang dihitung: baca artikel, selesaikan kuis, hadiri event
 */
export const updateUserStreak = async (userId) => {
  try {
    // Ambil data progres user
    const progressResult = await sql`
      SELECT 
        id_progres, 
        streak, 
        tanggal_catatan
      FROM data_progres_pengguna 
      WHERE id_pengguna = ${userId}
    `;

    if (progressResult.length === 0) {
      return { success: false, message: "User progress not found" };
    }

    const { id_progres, streak, tanggal_catatan } = progressResult[0];
    
    // Konversi tanggal_catatan ke timezone Jakarta
    const lastActivityDate = new Date(tanggal_catatan + "Z");
    const today = new Date();
    
    // Set jam ke 00:00:00 untuk perbandingan hari
    lastActivityDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    
    // Hitung selisih hari
    const diffTime = today - lastActivityDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    let newStreak = streak;
    
    if (diffDays === 0) {
      // Aktivitas di hari yang sama, streak tidak berubah
      return { success: true, streak: newStreak, message: "Same day activity" };
    } else if (diffDays === 1) {
      // Aktivitas hari berikutnya, streak bertambah
      newStreak = streak + 1;
    } else if (diffDays > 1) {
      // Terputus lebih dari 1 hari, reset streak
      newStreak = 1;
    }
    
    // Update streak dan tanggal_catatan
    await sql`
      UPDATE data_progres_pengguna
      SET 
        streak = ${newStreak},
        tanggal_catatan = NOW()
      WHERE id_pengguna = ${userId}
    `;
    
    return { 
      success: true, 
      streak: newStreak, 
      message: diffDays === 1 ? "Streak increased" : "Streak reset" 
    };
    
  } catch (error) {
    console.error("Error updating streak:", error);
    return { success: false, message: error.message };
  }
};

/**
 * Cek dan unlock badge untuk user berdasarkan kriteria
 */
export const checkAndUnlockBadges = async (userId) => {
  try {
    // Ambil data progres dan kemampuan literasi user
    const userStats = await sql`
      SELECT 
        dpp.id_progres,
        dpp.streak,
        dpp.artikel_dibaca,
        dpp.kuis_diselesaikan,
        dpp.event_dihadiri,
        ddkl.analisis_kritis,
        ddkl.kecepatan_membaca
      FROM data_progres_pengguna dpp
      LEFT JOIN data_detail_kemampuan_literasi ddkl ON dpp.id_progres = ddkl.id_progres
      WHERE dpp.id_pengguna = ${userId}
    `;

    if (userStats.length === 0) {
      return { success: false, message: "User stats not found" };
    }

    const stats = userStats[0];
    
    // Hitung kuis dengan skor sempurna (100)
    const perfectQuizzes = await sql`
      SELECT COUNT(*)::int as count
      FROM data_hasil_kuis
      WHERE id_pengguna = ${userId} AND total_skor_user = 100
    `;
    const kuisSempurna = perfectQuizzes[0]?.count || 0;

    // Ambil semua badge yang belum dimiliki user
    const availableBadges = await sql`
      SELECT ml.*
      FROM master_lencana ml
      WHERE ml.id_lencana NOT IN (
        SELECT id_lencana 
        FROM pengguna_lencana 
        WHERE id_pengguna = ${userId}
      )
    `;

    const unlockedBadges = [];

    // Cek setiap badge apakah memenuhi kriteria
    for (const badge of availableBadges) {
      let shouldUnlock = false;

      switch (badge.id_lencana) {
        case 'c46553a7-b139-45fa-9575-36f188c204f6': // Pembaca Aktif
          shouldUnlock = stats.artikel_dibaca >= 10;
          break;
        case '0872985a-23ab-410e-bc3a-0f868446ec5b': // Kuis Master
          shouldUnlock = kuisSempurna >= 10;
          break;
        case 'e30bdd98-cf70-47b9-8eef-fc84e5ba94b1': // Streak 7 Hari
          shouldUnlock = stats.streak >= 7;
          break;
        case '13b200f3-d0e3-4d40-b152-4b3e7c175151': // Event Explorer
          shouldUnlock = stats.event_dihadiri >= 5;
          break;
        case 'c0607ee2-08fd-4d53-b2f7-721866d7d39b': // Speed Reader
          shouldUnlock = stats.kecepatan_membaca >= 80;
          break;
        case 'c96aa9b5-a0fc-4d36-9b1d-2c5cd3f180ed': // Analyst Pro
          shouldUnlock = stats.analisis_kritis >= 90;
          break;
      }

      if (shouldUnlock) {
        // Unlock badge
        await sql`
          INSERT INTO pengguna_lencana (id_pengguna, id_lencana, tanggal_diperoleh)
          VALUES (${userId}, ${badge.id_lencana}, NOW())
        `;
        unlockedBadges.push({
          id: badge.id_lencana,
          name: badge.nama_lencana,
          icon: badge.ikon_emoji
        });
      }
    }

    return { 
      success: true, 
      unlockedBadges,
      message: unlockedBadges.length > 0 ? `Unlocked ${unlockedBadges.length} badge(s)` : "No new badges"
    };

  } catch (error) {
    console.error("Error checking badges:", error);
    return { success: false, message: error.message };
  }
};
