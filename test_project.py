from ERP.erp_client import ERPClient

def main():
    try:
        client = ERPClient()
        data = {"project_name": "Bajaj Finance Dashboard"}
        result = client.create_doc("Project", data)
        print("Success:", result)
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    main()
