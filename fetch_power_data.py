#!/usr/bin/env python3
# fetch_power_data.py

import sys
import json
import os
import importlib.util
from datetime import datetime

def main():
    if len(sys.argv) < 3:
        print("Usage: python fetch_power_data.py <user_id> <user_pwd> [date]", file=sys.stderr)
        sys.exit(1)
    
    # Get command line arguments
    user_id = sys.argv[1]
    user_pwd = sys.argv[2]
    
    # Optional date parameter (YYYY-MM-DD)
    if len(sys.argv) > 3:
        date = sys.argv[3]
    else:
        date = datetime.now().strftime('%Y-%m-%d')
    
    # Get the path to the powerplan.py module
    current_dir = os.path.dirname(os.path.abspath(__file__))
    
    # First try to find powerplan.py in the same directory
    powerplan_path = os.path.join(current_dir, 'powerplan.py')
    
    # If not found, try the parent directory
    if not os.path.exists(powerplan_path):
        parent_dir = os.path.dirname(current_dir)
        powerplan_path = os.path.join(parent_dir, 'powerplan.py')
    
    # If still not found, look in sibling directories
    if not os.path.exists(powerplan_path):
        parent_dir = os.path.dirname(current_dir)
        for sibling in os.listdir(parent_dir):
            sibling_path = os.path.join(parent_dir, sibling)
            if os.path.isdir(sibling_path):
                potential_path = os.path.join(sibling_path, 'powerplan.py')
                if os.path.exists(potential_path):
                    powerplan_path = potential_path
                    break
    
    # If still not found, try to find it in the user's home directory
    if not os.path.exists(powerplan_path):
        home_dir = os.path.expanduser('~')
        powerplan_path = os.path.join(home_dir, 'powerplan.py')
    
    # Check if the powerplan.py file exists
    if not os.path.exists(powerplan_path):
        print(f"Error: Could not find powerplan.py. Please specify its location.", file=sys.stderr)
        sys.exit(1)
    
    try:
        # Load the powerplan module
        spec = importlib.util.spec_from_file_location("powerplan", powerplan_path)
        powerplan = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(powerplan)
        
        # Fetch power data
        data = powerplan.scraping(user_id, user_pwd, scrap_date=date, simple=True)
        
        # Print the data as JSON
        print(json.dumps(data))
        
    except Exception as e:
        print(f"Error: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()