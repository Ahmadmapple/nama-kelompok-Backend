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
      // Tambahkan userId ke parameter terakhir
      values.push(userId);

      const query = `
        UPDATE pengguna
        SET ${setFields.join(", ")}
        WHERE id_pengguna = $${values.length}
        RETURNING id_pengguna, nama_pengguna, email_pengguna, foto_pengguna, role_pengguna
      `;

      updatedUser = await sql.query(query, values);
    }

    // Jika tidak ada update atau gagal, ambil data lama
    if (!updatedUser || updatedUser.length === 0) {
      const query = `
        SELECT id_pengguna, nama_pengguna, email_pengguna, foto_pengguna, role_pengguna
        FROM pengguna
        WHERE id_pengguna = $1
      `;
      const result = await sql.query(query, [userId]);
      updatedUser = result;
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
    const [skillsResult, badgesResult, historyResult] = await Promise.all([
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
          drb.tanggal_baca AS date
        FROM data_riwayat_bacaan drb
        JOIN data_artikel da ON drb.id_artikel = da.id_artikel
        JOIN data_progres_pengguna dpp ON drb.id_progres = dpp.id_progres
        WHERE dpp.id_pengguna = ${userId}
        ORDER BY drb.tanggal_baca DESC
        LIMIT 5
      `,
    ]);

    // Format skills
    const skillsRaw = skillsResult[0];
    const skills = skillsRaw
      ? [
          { name: "Pemahaman Bacaan", level: skillsRaw.pemahaman_bacaan || 0 },
          { name: "Kecepatan Membaca", level: skillsRaw.kecepatan_membaca || 0 },
          { name: "Analisis Kritis", level: skillsRaw.analisis_kritis || 0 },
          { name: "Fact Checking", level: skillsRaw.fact_checking || 0 },
          { name: "Menulis Ringkasan", level: skillsRaw.menulis_ringkasan || 0 },
        ]
      : [];

    const badges = badgesResult.map((b) => ({
      ...b,
      date: b.date ? b.date.toISOString().split("T")[0] : null,
    }));

    const readingHistory = historyResult.map((item) => ({
      ...item,
      date: new Date(item.date).toLocaleDateString("id-ID", { day: "numeric", month: "short" }),
    }));

    // Weekly goals logic
    const weeklyGoals = [
      { goal: "Baca 5 artikel", completed: 0, target: 5, progress: 0 },
      { goal: "Habiskan 3 jam membaca", completed: 0, target: 3, progress: 0 },
      { goal: "Selesaikan 5 kuis", completed: 0, target: 5, progress: 0 },
    ];

    res.json({ skills, badges, weeklyGoals, readingHistory });
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
        dp.waktu_membaca AS "readingTimeSeconds",
        dp.kuis_diselesaikan AS "quizzesCompleted",
        dp.event_dihadiri AS "eventsAttended"
      FROM pengguna p
      LEFT JOIN data_progres_pengguna dp ON p.id_pengguna = dp.id_pengguna
      WHERE p.id_pengguna = ${userId}
    `;

    const coreStats = result[0];
    if (!coreStats) return res.status(404).json({ message: "Profil tidak ditemukan." });

    // Convert reading time to string
    const seconds = coreStats.readingTimeSeconds || 0;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const readingTimeString = `${hours} jam ${minutes} menit`;

    const xpToNextLevel = (coreStats.level + 1) * 1000;

    res.json({
      name: coreStats.name,
      email: coreStats.email,
      avatar: coreStats.avatar,
      role: coreStats.role,
      memberSince: coreStats.memberSince,
      literacyScore: coreStats.literacyScore,
      statusPengguna: coreStats.status_pengguna,
      level: coreStats.level,
      xp: coreStats.xp,
      xpToNextLevel,
      currentStreak: coreStats.currentStreak,
      articlesRead: coreStats.articlesRead,
      readingTime: readingTimeString,
      quizzesCompleted: coreStats.quizzesCompleted,
      eventsAttended: coreStats.eventsAttended,
      // Optional: send placeholders for arrays
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
    res.status(500).json({ message: "Kesalahan server saat mengambil profil." });
  }
};

export { editProfile, getExtendedProfile, getBasicProfile };
