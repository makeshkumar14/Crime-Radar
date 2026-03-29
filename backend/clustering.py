import pandas as pd
import numpy as np
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
import sqlite3
from database import get_connection

def run_kmeans(n_clusters=12):
    print("Loading crime data...")
    conn = get_connection()
    
    df = pd.read_sql_query("""
        SELECT district, lat, lng, category, severity, 
               year, SUM(count) as total
        FROM fir_records
        GROUP BY district, lat, lng, category, severity, year
    """, conn)
    conn.close()

    if df.empty:
        print("No data found!")
        return

    print(f"Loaded {len(df)} records for clustering")

    # Prepare features for clustering
    features = df[['lat', 'lng', 'total']].copy()
    
    # Normalize features
    scaler = StandardScaler()
    scaled = scaler.fit_transform(features)

    # Run KMeans
    print(f"Running KMeans with {n_clusters} clusters...")
    kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
    df['cluster'] = kmeans.fit_predict(scaled)

    # Calculate hotspot info per cluster
    print("Calculating hotspot zones...")
    conn = get_connection()
    cursor = conn.cursor()

    # Clear existing hotspots
    cursor.execute("DELETE FROM hotspot_zones")

    for cluster_id in range(n_clusters):
        cluster_data = df[df['cluster'] == cluster_id]
        
        # Cluster center (in original coordinates)
        center_lat = cluster_data['lat'].mean()
        center_lng = cluster_data['lng'].mean()
        
        # Total crimes in cluster
        crime_count = int(cluster_data['total'].sum())
        
        # Radius based on spread of points
        lat_spread = cluster_data['lat'].std() or 0.1
        lng_spread = cluster_data['lng'].std() or 0.1
        radius_km = round(float(max(lat_spread, lng_spread) * 111), 2)
        radius_km = max(10, min(radius_km, 80))

        # Risk level based on crime count
        if crime_count > 5000:
            risk_level = 'HIGH'
            risk_score = min(95, 70 + (crime_count // 1000))
        elif crime_count > 2000:
            risk_level = 'MEDIUM'
            risk_score = min(69, 40 + (crime_count // 200))
        else:
            risk_level = 'LOW'
            risk_score = min(39, crime_count // 100)

        # Top crime in this cluster
        top_crime = cluster_data.groupby('category')['total'].sum()
        top_crime_name = top_crime.idxmax() if not top_crime.empty else 'Unknown'

        cursor.execute("""
            INSERT INTO hotspot_zones 
            (cluster_id, center_lat, center_lng, radius_km,
             risk_level, risk_score, crime_count, top_crime)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (cluster_id, center_lat, center_lng, radius_km,
              risk_level, risk_score, crime_count, top_crime_name))

        print(f"  Cluster {cluster_id}: {risk_level} | "
              f"{crime_count} crimes | "
              f"center ({center_lat:.2f}, {center_lng:.2f}) | "
              f"top crime: {top_crime_name}")

    conn.commit()
    conn.close()
    print(f"\nDone! {n_clusters} hotspot zones saved to database")

if __name__ == "__main__":
    run_kmeans(n_clusters=12)