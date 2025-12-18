import sql from "../config/db.js";

export const getPublicStats = async (req, res) => {
  try {
    const [row] = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM pengguna WHERE role_pengguna = 'user') as users,
        (SELECT COUNT(*)::int FROM data_artikel) as articles,
        (SELECT COUNT(*)::int FROM data_kuis) as quizzes,
        (SELECT COUNT(*)::int FROM data_event) as events,
        (SELECT COUNT(*)::int FROM data_penyelenggara) as organizers,
        (SELECT COUNT(*)::int FROM pengguna WHERE role_pengguna = 'user' AND tanggal_bergabung >= date_trunc('month', NOW())) as users_this_month
    `;

    const users = row?.users ?? 0;
    const articles = row?.articles ?? 0;
    const quizzes = row?.quizzes ?? 0;
    const events = row?.events ?? 0;

    res.json({
      stats: {
        users,
        usersThisMonth: row?.users_this_month ?? 0,
        articles,
        quizzes,
        events,
        content: articles + quizzes + events,
        organizers: row?.organizers ?? 0,
      },
    });
  } catch (error) {
    console.error("Error fetching public stats:", error);
    res.status(500).json({ message: "Gagal mengambil statistik" });
  }
};
