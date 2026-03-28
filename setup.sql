-- ============================================
-- WeatherPro - Supabase Database Setup
-- Run this in your Supabase SQL Editor
-- ============================================

-- 1. Create weather_searches table
CREATE TABLE IF NOT EXISTS weather_searches (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  visitor_id  VARCHAR(100) NOT NULL,
  city        VARCHAR(100) NOT NULL,
  country     VARCHAR(10),
  temperature DECIMAL(5,2),
  humidity    INTEGER,
  wind_speed  DECIMAL(6,2),
  condition   VARCHAR(100),
  icon        VARCHAR(20),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create page_visits table
CREATE TABLE IF NOT EXISTS page_visits (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  visitor_id  VARCHAR(100) NOT NULL,
  visited_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Enable Row Level Security
ALTER TABLE weather_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_visits      ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies — allow anon users to insert and read
CREATE POLICY "public_insert_searches" ON weather_searches
  FOR INSERT WITH CHECK (true);

CREATE POLICY "public_select_searches" ON weather_searches
  FOR SELECT USING (true);

CREATE POLICY "public_insert_visits" ON page_visits
  FOR INSERT WITH CHECK (true);

CREATE POLICY "public_select_visits" ON page_visits
  FOR SELECT USING (true);

-- 5. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_searches_created  ON weather_searches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_searches_city     ON weather_searches(city);
CREATE INDEX IF NOT EXISTS idx_visits_visitor    ON page_visits(visitor_id);
