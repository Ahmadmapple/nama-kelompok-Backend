import cloudinary from "../config/cloudinary.js";
import sql from "../config/db.js";

const editProfile = async (req, res) => {
  try {
    const { name } = req.body;
    const file = req.file;
    const userId = req.user.id; // Dari token/session

    let avatarUrl = null;

    // === UPLOAD KE CLOUDINARY ===
    if (file) {
      avatarUrl = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "avatars" },
          (error, result) => {
            if (error) reject(error);
            else resolve(result.secure_url);
          }
        );
        stream.end(file.buffer);
      });
    }

    // === BUILD PARAMETERIZED UPDATE QUERY ===
    const setFields = [];
    const values = [];

    if (name) {
      setFields.push(`nama_pengguna = $${values.length + 1}`);
      values.push(name);
    }

    if (avatarUrl) {
      setFields.push(`foto_pengguna = $${values.length + 1}`);
      values.push(avatarUrl);
    }

    let updatedUser;

    if (setFields.length > 0) {
      if (name && avatarUrl) {
        updatedUser = await sql`
          UPDATE pengguna
          SET nama_pengguna = ${name}, foto_pengguna = ${avatarUrl}
          WHERE id_pengguna = ${userId}
          RETURNING id_pengguna, nama_pengguna, email_pengguna, foto_pengguna, role_pengguna
        `;
      } else if (name) {
        updatedUser = await sql`
          UPDATE pengguna
          SET nama_pengguna = ${name}
          WHERE id_pengguna = ${userId}
          RETURNING id_pengguna, nama_pengguna, email_pengguna, foto_pengguna, role_pengguna
        `;
      } else if (avatarUrl) {
        updatedUser = await sql`
          UPDATE pengguna
          SET foto_pengguna = ${avatarUrl}
          WHERE id_pengguna = ${userId}
          RETURNING id_pengguna, nama_pengguna, email_pengguna, foto_pengguna, role_pengguna
        `;
      }
    }

    // Jika tidak ada update atau gagal, ambil data lama
    if (!updatedUser || updatedUser.length === 0) {
      updatedUser = await sql`
        SELECT id_pengguna, nama_pengguna, email_pengguna, foto_pengguna, role_pengguna
        FROM pengguna
        WHERE id_pengguna = ${userId}
        LIMIT 1
      `;
    }

    const user = updatedUser[0];

    if (!user) {
      return res.status(404).json({ message: "Pengguna tidak ditemukan." });
    }

    res.json({
      message: "Profil berhasil diperbarui",
      user: {
        id: user.id_pengguna,
        name: user.nama_pengguna,
        email: user.email_pengguna,
        avatar: user.foto_pengguna,
        role: user.role_pengguna,
      },
    });
  } catch (error) {
    console.error("Gagal update profil:", error);
    res.status(500).json({ message: "Gagal update profil" });
  }
};

const getExtendedProfile = async (req, res) => {
  const userId = req.user.id;

  try {
    const [skillsResult, badgesResult, historyResult, eventsResult, quizResult] = await Promise.all([
      // Skills
      sql`
        SELECT
          ddkl.pemahaman_bacaan,
          ddkl.kecepatan_membaca,
          ddkl.analisis_kritis,
          ddkl.fact_checking,
          ddkl.menulis_ringkasan
        FROM data_detail_kemampuan_literasi ddkl
        JOIN data_progres_pengguna dpp ON ddkl.id_progres = dpp.id_progres
        WHERE dpp.id_pengguna = ${userId}
      `,

      // Badges
      sql`
        SELECT
          ml.id_lencana AS id,
          ml.nama_lencana AS name,
          ml.ikon_emoji AS icon,
          CASE WHEN pul.id_pengguna_lencana IS NOT NULL THEN TRUE ELSE FALSE END AS earned,
          pul.tanggal_diperoleh AS date
        FROM master_lencana ml
        LEFT JOIN pengguna_lencana pul ON ml.id_lencana = pul.id_lencana AND pul.id_pengguna = ${userId}
      `,

      // Reading history
      sql`
        SELECT
          da.id_artikel AS id, 
          da.nama_artikel AS title,
          da.kategori AS category,
          drb.tanggal_baca AS date,
          100 AS progress
        FROM data_riwayat_bacaan drb
        JOIN data_artikel da ON drb.id_artikel = da.id_artikel
        JOIN data_progres_pengguna dpp ON drb.id_progres = dpp.id_progres
        WHERE dpp.id_pengguna = ${userId}
        ORDER BY drb.tanggal_baca DESC
        LIMIT 5
      `,

      // Event registration history
      sql`
        SELECT
          de.id_event AS id,
          de.judul_event AS title,
          de.jenis_acara AS type,
          de.tanggal_acara AS date,
          dpe.tanggal_daftar AS "registeredDate"
        FROM data_partisipasi_event dpe
        JOIN data_event de ON dpe.id_event = de.id_event
        WHERE dpe.id_pengguna = ${userId}
        ORDER BY dpe.tanggal_daftar DESC
        LIMIT 5
      `,

      // Quiz history - ambil hanya entry terbaru per quiz untuk menghindari duplikat
      sql`
        WITH latest_quiz_attempts AS (
          SELECT DISTINCT ON (dhk.id_kuis)
            dhk.id_hasil_kuis AS id,
            dk.judul_kuis AS title,
            dhk.total_skor_user AS score,
            dhk.tanggal_selesai AS date,
            dhk.id_kuis
          FROM data_hasil_kuis dhk
          JOIN data_kuis dk ON dhk.id_kuis = dk.id_kuis
          WHERE dhk.id_pengguna = ${userId}
          ORDER BY dhk.id_kuis, dhk.tanggal_selesai DESC
        )
        SELECT id, title, score, date
        FROM latest_quiz_attempts
        ORDER BY date DESC
        LIMIT 5
      `,
    ]);

    // Format skills
    const skillsRaw = skillsResult[0];
    const skills = skillsRaw
      ? [
          { name: "Pemahaman Bacaan", level: skillsRaw.pemahaman_bacaan || 0 },
          {
            name: "Kecepatan Membaca",
            level: skillsRaw.kecepatan_membaca || 0,
          },
          { name: "Analisis Kritis", level: skillsRaw.analisis_kritis || 0 },
          { name: "Fact Checking", level: skillsRaw.fact_checking || 0 },
          {
            name: "Menulis Ringkasan",
            level: skillsRaw.menulis_ringkasan || 0,
          },
        ]
      : [];

    // Helper function untuk format tanggal lengkap
    const formatFullDate = (dateString) => {
      if (!dateString) return 'N/A';
      const date = new Date(dateString + "Z"); // paksa dianggap UTC
      return date.toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    };

    const badges = badgesResult.map((b) => ({
      ...b,
      date: b.date ? formatFullDate(b.date) : null,
    }));

    // Format reading history dengan tanggal lengkap
    const readingHistory = historyResult.map((item) => ({
      ...item,
      date: formatFullDate(item.date),
    }));

    // Format event registration history dengan tanggal lengkap
    const registeredEvents = eventsResult.map((event) => ({
      id: event.id,
      title: event.title,
      type: event.type,
      date: formatFullDate(event.date),
      registeredDate: formatFullDate(event.registeredDate),
    }));

    // Format quiz history dengan tanggal lengkap
    const quizHistory = quizResult.map((quiz) => ({
      id: quiz.id,
      title: quiz.title,
      score: quiz.score,
      date: formatFullDate(quiz.date),
    }));

    // Weekly goals logic
    const weeklyGoals = [
      { goal: "Baca 5 artikel", completed: 0, target: 5, progress: 0 },
      { goal: "Habiskan 3 jam membaca", completed: 0, target: 3, progress: 0 },
      { goal: "Selesaikan 5 kuis", completed: 0, target: 5, progress: 0 },
    ];

    res.json({ skills, badges, weeklyGoals, readingHistory, registeredEvents, quizHistory });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Gagal mengambil extended profile" });
  }
};

const getBasicProfile = async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await sql`
      SELECT 
        p.nama_pengguna AS name,
        p.email_pengguna AS email,
        p.foto_pengguna AS avatar,
        p.role_pengguna AS role,
        p.status_pengguna,
        TO_CHAR(p.tanggal_bergabung, 'DD Mon YYYY') AS "memberSince",
        dp.skor_literasi_pengguna AS "literacyScore",
        dp.level_pengguna AS "level",
        dp.xp_pengguna AS xp,
        dp.streak AS "currentStreak",
        dp.artikel_dibaca AS "articlesRead",
        dp.waktu_membaca AS "totalMinutes", -- Kita beri alias totalMinutes agar jelas
        dp.kuis_diselesaikan AS "quizzesCompleted",
        dp.event_dihadiri AS "eventsAttended"
      FROM pengguna p
      LEFT JOIN data_progres_pengguna dp ON p.id_pengguna = dp.id_pengguna
      WHERE p.id_pengguna = ${userId}
    `;

    if (result.length === 0)
      return res.status(404).json({ message: "Profil tidak ditemukan." });

    const coreStats = result[0];

    // ================= FIX LOGIKA WAKTU =================
    // Karena di DB kamu simpan dalam MENIT, maka rumusnya:
    const totalMinutes = coreStats.totalMinutes || 0;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.floor(totalMinutes % 60);

    // Format string agar lebih rapi
    let readingTimeString = "";
    if (hours > 0) {
      readingTimeString = `${hours} jam ${minutes} menit`;
    } else {
      readingTimeString = `${minutes} menit`;
    }
    // ====================================================

    // Hitung XP yang dibutuhkan untuk level berikutnya
    // Formula: Level N membutuhkan total XP = 100 * (N-1) * N / 2
    // XP untuk naik ke level berikutnya = (level sekarang + 1) * 100
    const currentLevel = coreStats.level || 1;
    const currentXP = coreStats.xp || 0;
    
    // Hitung total XP yang sudah dikumpulkan untuk mencapai level saat ini
    let totalXPForCurrentLevel = 0;
    for (let i = 1; i < currentLevel; i++) {
      totalXPForCurrentLevel += (i * 100);
    }
    
    // XP yang dibutuhkan untuk naik ke level berikutnya
    const xpNeededForNextLevel = currentLevel * 100;
    
    // XP progress dalam level saat ini
    const xpInCurrentLevel = currentXP - totalXPForCurrentLevel;

    res.json({
      id: userId,
      name: coreStats.name,
      email: coreStats.email,
      avatar: coreStats.avatar,
      role: coreStats.role,
      memberSince: coreStats.memberSince,
      literacyScore: coreStats.literacyScore,
      statusPengguna: coreStats.status_pengguna,
      level: coreStats.level,
      xp: xpInCurrentLevel, // XP dalam level saat ini
      xpToNextLevel: xpNeededForNextLevel, // Total XP yang dibutuhkan untuk level berikutnya
      currentStreak: coreStats.currentStreak,
      articlesRead: coreStats.articlesRead,
      readingTime: readingTimeString, // Sekarang akan menampilkan "5 menit" atau "1 jam 5 menit"
      quizzesCompleted: coreStats.quizzesCompleted,
      eventsAttended: coreStats.eventsAttended,
      skills: [],
      badges: [],
      weeklyGoals: [],
      readingHistory: [],
      communityStats: {
        rank: 245,
        totalUsers: 10000,
        impactScore: 87,
      },
    });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ message: "Kesalahan server saat mengambil profil." });
  }
};

export { editProfile, getExtendedProfile, getBasicProfile };
