const express = require('express');
const router = express.Router();
const { pool } = require('../db.js');

router.get('/master-yield', async (req, res) => {
  try {
    const { startDate, endDate} = req.query;

    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ error: 'Missing required query parameters: startDate, endDate' });
    }

    const query =
        `WITH tb AS MATERIALIZED (
            SELECT
                sn,
                pn,
                model,
                workstation_name,
                history_station_passing_status AS status,
                history_station_end_time
            FROM testboard_master_log
            WHERE history_station_end_time AT Time zone 'America/New_York' >= $1
            AND history_station_end_time AT Time zone 'America/New_York' <  $2
            AND workstation_name = ANY(ARRAY['REPAIR','ASSY2','FLA','FCT','FQC','VI1','RECEIVE'])
        ),

        tb_keys AS MATERIALIZED (
            SELECT DISTINCT
                sn,
                workstation_name,
                history_station_end_time
            FROM tb
        ),

        ws AS MATERIALIZED (
            SELECT
                sn,
                pn,
                model,
                workstation_name,
                history_station_passing_status AS status,
                history_station_end_time
            FROM workstation_master_log
            WHERE history_station_end_time AT Time zone 'America/New_York' >= $1
            AND history_station_end_time AT Time zone 'America/New_York' <  $2
            AND workstation_name = ANY(ARRAY['REPAIR','ASSY2','FLA','FCT','FQC','VI1','RECEIVE'])
        ),

        combined AS (
            SELECT
                pn,
                model,
                workstation_name,
                status,
                date_trunc('week', history_station_end_time AT Time zone 'America/New_York')::date AS week_of
            FROM tb

            UNION ALL

            SELECT
                w.pn,
                w.model,
                w.workstation_name,
                w.status,
                date_trunc('week', history_station_end_time AT Time zone 'America/New_York')::date AS week_of
            FROM ws w
            LEFT JOIN tb_keys t
            ON t.sn = w.sn
            AND t.workstation_name = w.workstation_name
            AND t.history_station_end_time = w.history_station_end_time
            WHERE t.sn IS NULL
        )

        SELECT
            pn,
            model,
            to_char(week_of, 'YYYY-MM-DD') AS week_of,

            COUNT(*) FILTER (WHERE workstation_name ILIKE '%REPAIR%') AS repair_input,
            COUNT(*) FILTER (WHERE workstation_name ILIKE '%REPAIR%' AND status = 'Pass')  AS repair_output,
            COUNT(*) FILTER (WHERE workstation_name ILIKE '%REPAIR%' AND status = 'Scrap') AS repair_scrap,

            COUNT(*) FILTER (WHERE workstation_name = 'ASSY2') AS assy2,

            COUNT(*) FILTER (WHERE workstation_name = 'FLA') AS fla,
            COUNT(*) FILTER (WHERE workstation_name = 'FLA' AND status = 'Pass') AS fla_pass,
            COUNT(*) FILTER (WHERE workstation_name = 'FLA' AND status = 'Fail') AS fla_fail,

            COUNT(*) FILTER (WHERE workstation_name = 'FCT') AS fct,

            COUNT(*) FILTER (WHERE workstation_name = 'FQC') AS fqc,
            COUNT(*) FILTER (WHERE workstation_name = 'FQC' AND status = 'Pass') AS fqc_pass,
            COUNT(*) FILTER (WHERE workstation_name = 'FQC' AND status = 'Fail') AS fqc_fail,

            COUNT(*) FILTER (WHERE workstation_name = 'VI1') AS vi1,
            COUNT(*) FILTER (WHERE workstation_name = 'VI1' AND status = 'Pass') AS vi_pass,
            COUNT(*) FILTER (WHERE workstation_name = 'VI1' AND status = 'Fail') AS vi_fail,

            COUNT(*) FILTER (WHERE workstation_name = 'RECEIVE') AS receive

        FROM combined
        GROUP BY
            pn,
            model,
            week_of
        ORDER BY
            week_of DESC;`;


    const params = [startDate, endDate];
    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (error) {
    console.error('master-query:', error);
    return res.status(500).json({ error: error.message });
  }
});


module.exports = router; 